import { OrderResponseDto } from '../dto/order-response.dto';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { toOrderResponse } from './order-response.mapper';

describe('toOrderResponse', () => {
  const date: Date = new Date('2026-10-14T12:00:00.000Z');
  const item: OrderItem = Object.assign(new OrderItem(), {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    orderId: '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f',
    productId: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    productName: 'Teclado',
    price: 19.99,
    quantity: 3,
    subtotal: 59.97,
    createdAt: date,
  });
  const order: Order = Object.assign(new Order(), {
    id: '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f',
    userId: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    cartId: '7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    total: 59.97,
    status: OrderStatus.PENDING,
    paymentMethod: PaymentMethod.DEBIT_CARD,
    items: [item],
    createdAt: date,
    updatedAt: date,
  });

  it('devolve só os campos da RF-03, sem order nem orderId nos itens', () => {
    const response: OrderResponseDto = toOrderResponse(order);

    expect(response).toStrictEqual({
      id: order.id,
      userId: order.userId,
      cartId: order.cartId,
      total: 59.97,
      status: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.DEBIT_CARD,
      items: [
        {
          id: item.id,
          productId: item.productId,
          productName: 'Teclado',
          price: 19.99,
          quantity: 3,
          subtotal: 59.97,
          createdAt: date,
        },
      ],
      createdAt: date,
      updatedAt: date,
    });
  });

  it('pedido sem itens carregados devolve items vazio', () => {
    const response: OrderResponseDto = toOrderResponse(
      Object.assign(new Order(), { ...order, items: undefined }),
    );

    expect(response.items).toEqual([]);
  });
});
