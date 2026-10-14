import { Test, TestingModule } from '@nestjs/testing';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentQueueService } from './payment-queue.service';
import { PaymentOrderMessage } from '../payment-queue.interface';

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;
  let publishMessage: jest.Mock;

  const validOrder = (): PaymentOrderMessage => ({
    orderId: '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f',
    userId: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    amount: 549.88,
    items: [
      {
        productId: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        quantity: 1,
        price: 349.9,
      },
      {
        productId: '6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
        quantity: 2,
        price: 99.99,
      },
    ],
    paymentMethod: 'credit_card',
  });

  beforeEach(async () => {
    publishMessage = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQueueService,
        // mock: o teste não deve depender do RabbitMQ
        { provide: RabbitmqService, useValue: { publishMessage } },
      ],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publishPaymentOrder', () => {
    it('publica na exchange payments com a routing key payment.order', async () => {
      await service.publishPaymentOrder(validOrder());

      expect(publishMessage).toHaveBeenCalledTimes(1);
      expect(publishMessage).toHaveBeenCalledWith(
        'payments',
        'payment.order',
        expect.any(Object),
      );
    });

    it('mantém os dados do pedido e acrescenta createdAt e metadata', async () => {
      const order = validOrder();

      await service.publishPaymentOrder(order);

      const [, , message] = publishMessage.mock.calls[0] as [
        string,
        string,
        PaymentOrderMessage,
      ];
      expect(message).toMatchObject(order);
      // createdAt e timeStamp em ISO 8601, o formato que trafega no JSON
      expect(new Date(message.createdAt!).toISOString()).toBe(
        message.createdAt,
      );
      expect(message.metadata?.service).toBe('checkout-service');
      expect(new Date(message.metadata!.timeStamp).toISOString()).toBe(
        message.metadata!.timeStamp,
      );
    });

    it('preserva o createdAt informado', async () => {
      const createdAt = '2026-10-14T12:00:00.000Z';

      await service.publishPaymentOrder({ ...validOrder(), createdAt });

      const [, , message] = publishMessage.mock.calls[0] as [
        string,
        string,
        PaymentOrderMessage,
      ];
      expect(message.createdAt).toBe(createdAt);
    });
  });

  describe('publishPaymentOrderSafe', () => {
    it('publica um pedido válido', async () => {
      await service.publishPaymentOrderSafe(validOrder());

      expect(publishMessage).toHaveBeenCalledTimes(1);
    });

    it.each<[string, Partial<PaymentOrderMessage>]>([
      ['sem orderId', { orderId: '' }],
      ['sem userId', { userId: '' }],
      ['com amount zero', { amount: 0 }],
      ['com amount negativo', { amount: -10 }],
      ['sem itens', { items: [] }],
      ['sem paymentMethod', { paymentMethod: '' }],
      [
        'com item sem productId',
        { items: [{ productId: '', quantity: 1, price: 549.88 }] },
      ],
      [
        'com quantity zero',
        { items: [{ productId: 'p-1', quantity: 0, price: 549.88 }] },
      ],
      [
        'com quantity fracionada',
        { items: [{ productId: 'p-1', quantity: 1.5, price: 549.88 }] },
      ],
      [
        'com price zero',
        { amount: 1, items: [{ productId: 'p-1', quantity: 1, price: 0 }] },
      ],
      ['com amount diferente da soma dos itens', { amount: 549.89 }],
    ])('rejeita pedido %s e não publica', async (_, override) => {
      await expect(
        service.publishPaymentOrderSafe({ ...validOrder(), ...override }),
      ).rejects.toThrow('Invalid payment order');

      expect(publishMessage).not.toHaveBeenCalled();
    });
  });
});
