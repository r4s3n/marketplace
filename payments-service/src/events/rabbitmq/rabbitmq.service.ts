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

type SubscribeOptions = {
  maxRetries?: number; // maximo de tentativas de reprocessamento da mensagem antes de enviar para a fila de dead letter. Padrão é 3 tentativas
  retryDelayMs?: number; // tempo de espera entre as tentativas de reprocessamento da mensagem. Padrão é 30000ms
};

// inscrição registrada: refeita a cada reconexão
type Subscription = {
  queueName: string;
  exchange: string;
  routingKey: string;
  callback: (message: unknown) => Promise<void>;
  options: SubscribeOptions;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel | null = null; // faz a conexão com rabbitMQ
  private channel: amqp.Channel | null = null; // abre o canal de comunicação
  private readonly subscriptions: Subscription[] = [];
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

  async waitForConnection(maxAttemps = 10, delayMs = 500): Promise<boolean> {
    // faço um loop para esperar a conexão com o rabbitMQ, caso não tenha conexão, ele espera 500ms e tenta novamente, até 10 tentativas
    for (let attempt = 1; attempt <= maxAttemps; attempt++) {
      if (this.channel) {
        return true;
      }

      this.logger.log(
        `⏳ Waiting for RabbitMQ connection... (attempt ${attempt})/${maxAttemps}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
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

      // depois de uma queda, volta a consumir as filas já registradas
      for (const subscription of this.subscriptions) {
        await this.setupSubscription(channel, subscription);
      }
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

  async publishMessage(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    const channel: amqp.Channel | null = this.channel;
    try {
      if (!channel) {
        //confiro se tem alguma canal aberto
        this.logger.warn(
          '⚠️ RabbitMQ channel not available, skipping message publish',
        );
        return;
      }
      //topic permite roteamento complexos, e o durable true, persiste a mensagem a qualquer restart
      await channel.assertExchange(exchange, 'topic', { durable: true });
      // convertemos a mensagem para o formato binario
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = channel.publish(exchange, routingKey, messageBuffer, {
        persistent: true,
        timestamp: Date.now(),
        contentType: 'application/json',
      });

      if (!published) {
        throw new Error('Failed to publish message to RabbitMQ');
      }

      this.logger.log(`✅ Message published to ${exchange}:${routingKey}`);
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
    } catch (error: any) {
      this.logger.error(`❌ Error publishing message to RabbitMQ:`, error);
    }
  }

  // para consumir as mensagens de uma fila, primeiro eu preciso me inscrever nela.
  // a inscrição fica registrada e é refeita automaticamente após uma reconexão
  async subscribeToqueue(
    queueName: string,
    exchange: string,
    routingKey: string,
    callback: (message: unknown) => Promise<void>,
    options: SubscribeOptions = {},
  ): Promise<void> {
    const subscription: Subscription = {
      queueName,
      exchange,
      routingKey,
      callback,
      options,
    };
    this.subscriptions.push(subscription);

    const channel: amqp.Channel | null = this.channel;
    if (!channel) {
      this.logger.error(
        `❌ Error subscribing to queue ${queueName}: RabbitMQ channel not available (will subscribe on reconnect)`,
      );
      return;
    }
    await this.setupSubscription(channel, subscription);
  }

  private async setupSubscription(
    channel: amqp.Channel,
    { queueName, exchange, routingKey, callback, options }: Subscription,
  ): Promise<void> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 30000; // 30 segundos
    try {
      // garante que a fila existe, e como verificar se o centro de triagem da mensagem existe
      await channel.assertExchange(exchange, 'topic', {
        durable: true,
      });

      // cria um exchange de retry, que vai receber as mensagens que não foram processadas e depois mandar para reprocessamento
      const retryExchange = `${exchange}.retry`;
      await channel.assertExchange(retryExchange, 'topic', {
        durable: true,
      });

      // cria um exchange de dead letter, que vai receber as mensagens que não foram reprocessadas ( após o retry )
      const dlxExchange = `${exchange}.dlx`;
      await channel.assertExchange(dlxExchange, 'topic', {
        durable: true,
      });

      // DLQ
      // cria a fila de dead letter, que vai receber as mensagens que não foram processadas
      const dlqName = `${queueName}.dlq`;
      await channel.assertQueue(dlqName, {
        durable: true,
        arguments: {
          'x-message-ttl': 604800000, // 7 dias para analise
        },
      });

      const routinfKeyDlq = `${routingKey}.dlq`;
      await channel.bindQueue(dlqName, dlxExchange, routinfKeyDlq);

      // RETRY
      const retryQueueName = `${queueName}.retry`;
      const routinfKeyRetry = `${routingKey}.retry`;

      await channel.assertQueue(retryQueueName, {
        durable: true,
        arguments: {
          'x-message-ttl': retryDelayMs, // Tempo de espera antes do retry. Quando o tempo acaba, a MSG volta para o exchange principal
          'x-dead-letter-exchange': exchange,
          'x-dead-letter-routing-key': routingKey,
        },
      });
      await channel.bindQueue(retryQueueName, retryExchange, routinfKeyRetry);

      // MAIN QUEUE
      // pego a fila existente, se não existir, crio uma fila com o nome
      const queue = await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000, //tempo total de duranção da mensagem, 1h
          'x-max-length': 10000, //maximo de mensagens que ficarão na fila
          'x-dead-letter-exchange': retryExchange, //roteamento para a fila de retry
          'x-dead-letter-routing-key': routinfKeyRetry, //roteamento para a fila de retry
        },
      });

      // conecto a fila com o meu centro de triagem(exchange) usando o routing key
      await channel.bindQueue(queue.queue, exchange, routingKey);
      // falo quantas mensagens vou ler por vez, neste caso, uma por vez
      await channel.prefetch(1);

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      await channel.consume(queue.queue, async (msg) => {
        if (msg) {
          try {
            const message: unknown = JSON.parse(msg.content.toString());
            this.logger.log(`✉️ Message received from queue: ${queueName}`);
            this.logger.debug(`Message content: ${JSON.stringify(message)}`);

            const retryCount = this.getRetryCount(msg);
            this.logger.log(
              `✉️ Message received (attemp ${retryCount + 1}/${maxRetries + 1})`,
            );

            await callback(message);

            // aceitamos a mensagem
            channel.ack(msg);

            this.logger.log(
              `✅ Message processed successfully from queue: ${queueName}`,
            );
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (error) {
            const retryCount = this.getRetryCount(msg);

            if (retryCount < maxRetries) {
              this.logger.warn(
                `⚠️ Processing failed (attemp ${retryCount + 1}/${maxRetries + 1}).` +
                  `Retrying in ${retryDelayMs / 1000}s...`,
              );
              // negamos a mensagem
              channel.nack(msg, false, false);
            } else {
              this.logger.error(
                `💀 Max Retries (${maxRetries}) exceeded. Sending to DLQ.`,
              );
              // Publica diretamente na DLQ (bypass da retry queue)
              channel.publish(dlxExchange, `${routingKey}.dlq`, msg.content, {
                persistent: true,
                headers: msg.properties.headers,
              });
              channel.ack(msg);
            }
            this.logger.warn(`⚠️ Message sent to DLQ: ${dlqName}`);
          }
        }
      });
      this.logger.log(`✅ Subscribed to queue: ${queueName}`);
      this.logger.log(
        `🔄 Retry queue: ${retryQueueName} (${retryDelayMs}ms delay)`,
      );
      this.logger.log(`💀 Dead letter queue: ${dlqName}`);
    } catch (error) {
      this.logger.error(`❌ Error subscribing to queue ${queueName}:`, error);
    }
  }

  /**
   * Extrai o numero de retries do header x-death
   * O rabbitMQ adiciona esse header automaticamente
   */

  private getRetryCount(msg: amqp.ConsumeMessage): number {
    const xDeath = msg.properties.headers?.['x-death'] as
      | Array<{
          count: number;
          queue: string;
        }>
      | undefined;

    if (!xDeath || xDeath.length === 0) {
      return 0;
    }

    // soma todas as vezes que passou pela fila principal
    return xDeath
      .filter((death) => !death.queue.endsWith('.retry'))
      .reduce((sum, death) => sum + (death.count || 0), 0);
  }
}
