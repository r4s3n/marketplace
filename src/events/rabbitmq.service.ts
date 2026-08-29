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
}
