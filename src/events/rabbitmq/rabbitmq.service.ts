import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection!: amqp.ChannelModel; // faz a conexão com rabbitMQ
  private channel!: amqp.Channel; // abre o canal de comunicação

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
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

  private async connect() {
    try {
      const rabbitmqUrl = this.configService.get<string>(
        'RABBITMQ_URL',
        'amqp://admin:admin@localhost:5672',
      );

      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      this.logger.log('✅ Connected to RabbitMQ successfully');

      // event listerers para monitoramento de sessão
      this.channel.on('error', (err) => {
        this.logger.error('❌ RabbitMQ connection error:', err);
      });

      this.channel.on('close', () => {
        this.logger.error('⚠️ RabbitMQ connection closed');
      });

      this.channel.on('blocked', (reason) => {
        this.logger.error('⚠️ RabbitMQ connection blocked:', reason);
      });

      this.channel.on('unblocked', () => {
        this.logger.error('✅ RabbitMQ connection unblocked');
      });
    } catch (error: any) {
      this.logger.warn(
        '⚠️ Failed to connect to RabbitMQ, continuing without message queue:',
        error.message,
      );
    }
  }

  private async disconnect() {
    try {
      // fecho o canal
      if (this.channel) {
        await this.channel.close();
        this.logger.log('✅ RabbitMQ channel closed');
      }
      // fecho a conexão
      if (this.connection) {
        await this.connection.close();
        this.logger.log('✅ Disconnect from RabbitMQ');
      }
    } catch (error) {
      this.logger.error('❌ Error disconnecting from RabbitMQ:', error);
    }
  }

  // getters
  getChannel(): amqp.Channel {
    return this.channel;
  }

  getConnection(): amqp.ChannelModel {
    return this.connection;
  }

  async publishMessage(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    try {
      if (!this.channel) {
        //confiro se tem alguma canal aberto
        this.logger.warn(
          '⚠️ RabbitMQ channel not available, skipping message publish',
        );
        return;
      }
      //topic permite roteamento complexos, e o durable true, persiste a mensagem a qualquer restart
      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      // convertemos a mensagem para o formato binario
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = this.channel.publish(
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
    } catch (error: any) {
      this.logger.error(`❌ Error publishing message to RabbitMQ:`, error);
    }
  }

  // para consumir as mensagens de uma fila, primeiro eu preciso me inscrever nela
  async subscribeToqueue(
    queueName: string,
    exchange: string,
    routingKey: string,
    callback: (message: unknown) => Promise<void>,
  ): Promise<void> {
    try {
      if (!this.channel) {
        throw new Error('RabbitMQ channel not available');
      }

      // garante que a fila existe, e como verificar se o centro de triagem da mensagem existe
      await this.channel.assertExchange(exchange, 'topic', {
        durable: true,
      });

      // pego a fila existente, se não existir, crio uma fila com o nome
      const queue = await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000, //tempo total de duranção da mensagem, 1h
          'x-max-length': 10000, //maximo de mensagens que ficarão na fila
        },
      });

      // conecto a fila com o meu centro de triagem(exchange) usando o routing key
      await this.channel.bindQueue(queue.queue, exchange, routingKey);
      // falo quantas mensagens vou ler por vez, neste caso, uma por vez
      await this.channel.prefetch(1);

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      await this.channel.consume(queue.queue, async (msg) => {
        if (msg) {
          try {
            const message: unknown = JSON.parse(msg.content.toString());
            this.logger.log(`✉️ Message received from queue: ${queueName}`);
            this.logger.debug(`Message content: ${JSON.stringify(message)}`);
            await callback(message);

            // aceitamos a mensagem
            this.channel.ack(msg);

            this.logger.log(
              `✅ Message processed successfully from queue: ${queueName}`,
            );
          } catch (error) {
            this.logger.error(`❌ Error processing message:`, error);
            // negamos a mensagem
            this.channel.nack(msg, false, false);
          }
        }
      });
      this.logger.log(
        `✅ Subscribed to queue: ${queueName} with routing key: ${routingKey}`,
      );
    } catch (error) {
      this.logger.error(`❌ Error subscribing to queue ${queueName}:`, error);
    }
  }
}
