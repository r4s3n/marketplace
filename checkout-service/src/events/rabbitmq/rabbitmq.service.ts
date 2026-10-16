import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfigService } from '@nestjs/config';

// intervalo entre as tentativas de reconexão
export const RECONNECT_DELAY_MS: number = 5000;

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel | null = null; // faz a conexão com rabbitMQ
  private channel: amqp.Channel | null = null; // abre o canal de comunicação
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shuttingDown: boolean = false; // no desligamento não reconecta

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.disconnect();
  }

  // se falhar, não derruba a aplicação: tenta de novo a cada RECONNECT_DELAY_MS
  private async connect(): Promise<void> {
    const rabbitmqUrl: string = this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://admin:admin@localhost:5672',
    );

    try {
      const connection: amqp.ChannelModel = await amqp.connect(rabbitmqUrl);
      const channel: amqp.Channel = await connection.createChannel();

      // event listeners para monitoramento da sessão
      connection.on('error', (error: Error): void => {
        this.logger.error(`❌ RabbitMQ connection error: ${error.message}`);
      });
      connection.on('close', (): void => this.handleConnectionLost(connection));
      channel.on('error', (error: Error): void => {
        this.logger.error(`❌ RabbitMQ channel error: ${error.message}`);
      });
      // canal fechado sozinho (ex.: erro de protocolo): refaz a conexão inteira
      channel.on('close', (): void => this.handleConnectionLost(connection));
      connection.on('blocked', (reason: string): void => {
        this.logger.warn(`⚠️ RabbitMQ connection blocked: ${reason}`);
      });
      connection.on('unblocked', (): void => {
        this.logger.log('✅ RabbitMQ connection unblocked');
      });

      this.connection = connection;
      this.channel = channel;
      this.logger.log('✅ Connected to RabbitMQ successfully');
    } catch (error: unknown) {
      this.logger.warn(
        `⚠️ Failed to connect to RabbitMQ (${reasonOf(error)}), retrying in ${RECONNECT_DELAY_MS / 1000}s`,
      );
      this.scheduleReconnect();
    }
  }

  // eventos de uma conexão antiga (já substituída) são ignorados
  private handleConnectionLost(connection: amqp.ChannelModel): void {
    if (this.connection !== connection) {
      return;
    }
    this.connection = null;
    this.channel = null;
    // se só o canal caiu, a conexão ainda está aberta: fecha para não vazar
    connection.close().catch((): void => undefined);

    if (this.shuttingDown) {
      return;
    }
    this.logger.error(
      `⚠️ RabbitMQ connection lost, reconnecting in ${RECONNECT_DELAY_MS / 1000}s`,
    );
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout((): void => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_DELAY_MS);
    // o timer não segura o processo vivo (ex.: fim dos testes)
    this.reconnectTimer.unref();
  }

  private async disconnect(): Promise<void> {
    const channel: amqp.Channel | null = this.channel;
    const connection: amqp.ChannelModel | null = this.connection;
    this.channel = null;
    this.connection = null;

    try {
      // fecho o canal
      if (channel) {
        await channel.close();
        this.logger.log('✅ RabbitMQ channel closed');
      }
      // fecho a conexão
      if (connection) {
        await connection.close();
        this.logger.log('✅ Disconnect from RabbitMQ');
      }
    } catch (error: unknown) {
      this.logger.error(
        `❌ Error disconnecting from RabbitMQ: ${reasonOf(error)}`,
      );
    }
  }

  // getters
  getChannel(): amqp.Channel | null {
    return this.channel;
  }

  getConnection(): amqp.ChannelModel | null {
    return this.connection;
  }

  // lança erro quando não publica: quem chama decide o que fazer com a falha
  async publishMessage(
    exchange: string,
    routingKey: string,
    message: unknown,
  ): Promise<void> {
    const channel: amqp.Channel | null = this.channel;

    try {
      if (!channel) {
        throw new Error('RabbitMQ channel not available');
      }
      //topic permite roteamento complexos, e o durable true, persiste a mensagem a qualquer restart
      await channel.assertExchange(exchange, 'topic', { durable: true });
      // convertemos a mensagem para o formato binario
      const messageBuffer: Buffer = Buffer.from(JSON.stringify(message));

      const published: boolean = channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        },
      );

      if (!published) {
        throw new Error('Failed to publish message to RabbitMQ');
      }

      this.logger.log(`✅ Message published to ${exchange}:${routingKey}`);
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
    } catch (error: unknown) {
      this.logger.error(
        `❌ Error publishing message to RabbitMQ: ${reasonOf(error)}`,
      );
      throw error;
    }
  }

  // para consumir as mensagens de uma fila, primeiro eu preciso me inscrever nela
  async subscribeToqueue(
    queueName: string,
    exchange: string,
    routingKey: string,
    callback: (message: unknown) => Promise<void>,
  ): Promise<void> {
    const channel: amqp.Channel | null = this.channel;

    try {
      if (!channel) {
        throw new Error('RabbitMQ channel not available');
      }

      // garante que a fila existe, e como verificar se o centro de triagem da mensagem existe
      await channel.assertExchange(exchange, 'topic', {
        durable: true,
      });

      // pego a fila existente, se não existir, crio uma fila com o nome
      const queue: amqp.Replies.AssertQueue = await channel.assertQueue(
        queueName,
        {
          durable: true,
          arguments: {
            'x-message-ttl': 86400000, //tempo total de duranção da mensagem, 1h
            'x-max-length': 10000, //maximo de mensagens que ficarão na fila
          },
        },
      );

      // conecto a fila com o meu centro de triagem(exchange) usando o routing key
      await channel.bindQueue(queue.queue, exchange, routingKey);
      // falo quantas mensagens vou ler por vez, neste caso, uma por vez
      await channel.prefetch(1);

      await channel.consume(
        queue.queue,
        // o amqplib não espera a promise; erros são tratados dentro do callback
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async (msg: amqp.ConsumeMessage | null): Promise<void> => {
          if (msg) {
            try {
              const message: unknown = JSON.parse(msg.content.toString());
              this.logger.log(`✉️ Message received from queue: ${queueName}`);
              this.logger.debug(`Message content: ${JSON.stringify(message)}`);
              await callback(message);

              // aceitamos a mensagem
              channel.ack(msg);

              this.logger.log(
                `✅ Message processed successfully from queue: ${queueName}`,
              );
            } catch (error: unknown) {
              this.logger.error(
                `❌ Error processing message: ${reasonOf(error)}`,
              );
              // negamos a mensagem
              channel.nack(msg, false, false);
            }
          }
        },
      );
      this.logger.log(
        `✅ Subscribed to queue: ${queueName} with routing key: ${routingKey}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `❌ Error subscribing to queue ${queueName}: ${reasonOf(error)}`,
      );
    }
  }
}
