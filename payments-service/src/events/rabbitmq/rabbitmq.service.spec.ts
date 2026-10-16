import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EventEmitter } from 'events';
import { RabbitmqService, RECONNECT_DELAY_MS } from './rabbitmq.service';

jest.mock('amqplib', (): { connect: jest.Mock } => ({ connect: jest.fn() }));

type FakeChannel = EventEmitter & {
  assertExchange: jest.Mock;
  assertQueue: jest.Mock;
  bindQueue: jest.Mock;
  prefetch: jest.Mock;
  consume: jest.Mock;
  close: jest.Mock;
};
type FakeConnection = EventEmitter & {
  createChannel: jest.Mock;
  close: jest.Mock;
};

const makeChannel = (): FakeChannel =>
  Object.assign(new EventEmitter(), {
    assertExchange: jest.fn().mockResolvedValue({}),
    assertQueue: jest
      .fn()
      .mockImplementation((queue: string): Promise<{ queue: string }> =>
        Promise.resolve({ queue }),
      ),
    bindQueue: jest.fn().mockResolvedValue({}),
    prefetch: jest.fn().mockResolvedValue({}),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'tag' }),
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
  const callback: jest.Mock<Promise<void>, [unknown]> = jest.fn(
    (): Promise<void> => Promise.resolve(),
  );
  let service: RabbitmqService;

  // deixa as promises pendentes (connect, assertQueue...) resolverem
  const flush = async (): Promise<void> => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };

  const consumedQueues = (channel: FakeChannel): string[] =>
    channel.consume.mock.calls.map(
      (call: unknown[]): string => call[0] as string,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation((): void => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((): void => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation((): void => {});
    service = new RabbitmqService(config);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('depois de uma queda reconecta e volta a consumir a fila', async () => {
    const first: FakeChannel = makeChannel();
    const firstConnection: FakeConnection = makeConnection(first);
    const second: FakeChannel = makeChannel();
    connect
      .mockResolvedValueOnce(firstConnection)
      .mockResolvedValueOnce(makeConnection(second));
    await service.onModuleInit();
    await service.subscribeToqueue(
      'payment_queue',
      'payments',
      'payment.order',
      callback,
    );
    expect(consumedQueues(first)).toEqual(['payment_queue']);

    firstConnection.emit('close');
    expect(service.getChannel()).toBeNull();

    jest.advanceTimersByTime(RECONNECT_DELAY_MS);
    await flush();

    expect(service.getChannel()).toBe(second);
    expect(consumedQueues(second)).toEqual(['payment_queue']);
    expect(second.bindQueue).toHaveBeenCalledWith(
      'payment_queue',
      'payments',
      'payment.order',
    );
  });

  it('inscrição feita sem conexão é ativada quando a conexão sobe', async () => {
    const channel: FakeChannel = makeChannel();
    connect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeConnection(channel));
    await service.onModuleInit();

    await service.subscribeToqueue(
      'payment_queue',
      'payments',
      'payment.order',
      callback,
    );
    expect(channel.consume).not.toHaveBeenCalled();

    jest.advanceTimersByTime(RECONNECT_DELAY_MS);
    await flush();

    expect(consumedQueues(channel)).toEqual(['payment_queue']);
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
