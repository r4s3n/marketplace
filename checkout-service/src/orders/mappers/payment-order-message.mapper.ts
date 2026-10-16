import { PaymentOrderMessage } from '../../events/payment-queue.interface';
import { Order } from '../entities/order.entity';

// monta a mensagem para o payments-service só com dados do pedido (itens inclusos)
export const toPaymentOrderMessage = (order: Order): PaymentOrderMessage => ({
  orderId: order.id,
  userId: order.userId,
  amount: order.total,
  items: order.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    price: item.price,
  })),
  paymentMethod: order.paymentMethod,
  createdAt: order.createdAt.toISOString(),
});
