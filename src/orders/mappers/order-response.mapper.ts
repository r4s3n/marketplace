import {
  OrderItemResponseDto,
  OrderResponseDto,
} from '../dto/order-response.dto';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';

// itens sem order nem orderId; a ordem dos itens não faz parte do contrato
const toOrderItemResponse = ({
  id,
  productId,
  productName,
  price,
  quantity,
  subtotal,
  createdAt,
}: OrderItem): OrderItemResponseDto => ({
  id,
  productId,
  productName,
  price,
  quantity,
  subtotal,
  createdAt,
});

export const toOrderResponse = (order: Order): OrderResponseDto => ({
  id: order.id,
  userId: order.userId,
  cartId: order.cartId,
  total: order.total,
  status: order.status,
  paymentMethod: order.paymentMethod,
  items: (order.items ?? []).map(toOrderItemResponse),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});
