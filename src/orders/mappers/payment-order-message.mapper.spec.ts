import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { toPaymentOrderMessage } from './payment-order-message.mapper';

describe('toPaymentOrderMessage', () => {
  const order = Object.assign(new Order(), {
    id: '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f',
    userId: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    cartId: '7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    total: 549.88,
    status: OrderStatus.PENDING,
    paymentMethod: 'credit_card',
    createdAt: new Date('2026-10-14T12:00:00.000Z'),
    updatedAt: new Date('2026-10-14T12:00:00.000Z'),
    items: [
      Object.assign(new OrderItem(), {
        id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        productId: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        productName: 'Teclado',
        price: 349.9,
        quantity: 1,
        subtotal: 349.9,
      }),
      Object.assign(new OrderItem(), {
        id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
        productId: '6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
        productName: 'Mouse',
        price: 99.99,
        quantity: 2,
        subtotal: 199.98,
      }),
    ],
  });

  it('monta a mensagem com os dados do pedido e só productId, quantity e price por item', () => {
    expect(toPaymentOrderMessage(order)).toStrictEqual({
      orderId: order.id,
      userId: order.userId,
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
      createdAt: '2026-10-14T12:00:00.000Z',
    });
  });
});
