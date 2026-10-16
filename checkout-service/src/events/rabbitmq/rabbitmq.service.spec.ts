import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EventEmitter } from 'events';
import { RabbitmqService, RECONNECT_DELAY_MS } from './rabbitmq.service';

jest.mock('amqplib', (): { connect: jest.Mock } => ({ connect: jest.fn() }));

type FakeChannel = EventEmitter & {
  assertExchange: jest.Mock;
  publish: jest.Mock;
  close: jest.Mock;
};
type FakeConnection = EventEmitter & {
  createChannel: jest.Mock;
  close: jest.Mock;
};

const makeChannel = (): FakeChannel =>
  Object.assign(new EventEmitter(), {
    assertExchange: jest.fn().mockResolvedValue({}),
    publish: jest.fn().mockReturnValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  });

const makeConnection = (channel: FakeChannel): FakeConnection =>
  Object.assign(new EventEmitter(), {
    createChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  });

describe('RabbitmqService', () => {
  const connect: jest.Mock = amqp.connect as unknown as jest.Mock;
  const config: ConfigService = {
    get: (_: string, fallback: string): string => fallback,
  } as unknown as ConfigService;
  let service: RabbitmqService;

  // deixa as promises pendentes (connect, createChannel) resolverem
  const flush = async (): Promise<void> => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation((): void => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((): void => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation((): void => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation((): void => {});
    service = new RabbitmqService(config);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('publishMessage', () => {
    it('publica no exchange com a routing key', async () => {
      const channel: FakeChannel = makeChannel();
      connect.mockResolvedValue(makeConnection(channel));
      await service.onModuleInit();

      await service.publishMessage('payments', 'payment.order', { id: 1 });

      expect(channel.assertExchange).toHaveBeenCalledWith('payments', 'topic', {
        durable: true,
      });
      expect(channel.publish).toHaveBeenCalledWith(
        'payments',
        'payment.order',
        Buffer.from(JSON.stringify({ id: 1 })),
        expect.objectContaining({ persistent: true }),
      );
    });

    it('sem conexão lança erro em vez de ignorar a mensagem', async () => {
      connect.mockRejectedValue(new Error('ECONNREFUSED'));
      await service.onModuleInit();

      await expect(
        service.publishMessage('payments', 'payment.order', {}),
      ).rejects.toThrow('RabbitMQ channel not available');
    });

    it('falha do canal ao publicar é propagada', async () => {
      const channel: FakeChannel = makeChannel();
      channel.publish.mockImplementation((): boolean => {
        throw new Error('Channel closed');
      });
      connect.mockResolvedValue(makeConnection(channel));
      await service.onModuleInit();

      await expect(
        service.publishMessage('payments', 'payment.order', {}),
      ).rejects.toThrow('Channel closed');
    });
  });

  describe('reconexão', () => {
    it('falha na conexão inicial tenta de novo depois do intervalo', async () => {
      const channel: FakeChannel = makeChannel();
      connect
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(makeConnection(channel));

      await service.onModuleInit();
      expect(service.getChannel()).toBeNull();

      jest.advanceTimersByTime(RECONNECT_DELAY_MS);
      await flush();

      expect(connect).toHaveBeenCalledTimes(2);
      expect(service.getChannel()).toBe(channel);
    });

    it('conexão caída é refeita e volta a publicar', async () => {
      const first: FakeConnection = makeConnection(makeChannel());
      const channel: FakeChannel = makeChannel();
      connect
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(makeConnection(channel));
      await service.onModuleInit();

      first.emit('close');
      expect(service.getChannel()).toBeNull();
      await expect(
        service.publishMessage('payments', 'payment.order', {}),
      ).rejects.toThrow('RabbitMQ channel not available');

      jest.advanceTimersByTime(RECONNECT_DELAY_MS);
      await flush();

      await service.publishMessage('payments', 'payment.order', {});
      expect(channel.publish).toHaveBeenCalledTimes(1);
    });

    it('canal e conexão fechando juntos agendam uma única reconexão', async () => {
      const channel: FakeChannel = makeChannel();
      const connection: FakeConnection = makeConnection(channel);
      connect.mockResolvedValue(connection);
      await service.onModuleInit();

      channel.emit('close');
      connection.emit('close');
      jest.advanceTimersByTime(RECONNECT_DELAY_MS);
      await flush();

      expect(connect).toHaveBeenCalledTimes(2);
    });

    it('no desligamento não reconecta', async () => {
      const connection: FakeConnection = makeConnection(makeChannel());
      connect.mockResolvedValue(connection);
      await service.onModuleInit();

      await service.onModuleDestroy();
      connection.emit('close');
      jest.advanceTimersByTime(RECONNECT_DELAY_MS);
      await flush();

      expect(connect).toHaveBeenCalledTimes(1);
    });
  });
});
