import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq.service';
import { PaymentOrderMessage } from '../payment-queue.interface';

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);
  private readonly ROUTING_KEY = 'payment.order';
  private readonly EXCHANGE = 'payments';

  constructor(private readonly rabbitMQService: RabbitmqService) {}

  // vai publicar na fila a mensagem com os dados de pagamento
  async publishPaymentOrder(paymentOrder: PaymentOrderMessage): Promise<void> {
    this.logger.log(
      `📤 Publishng payment order for orderId: ${paymentOrder.orderId}`,
    );

    try {
      // adiciono mais informações ao meu pagamento
      const enrichmentMessage: PaymentOrderMessage = {
        ...paymentOrder,
        createdAt: paymentOrder.createdAt || new Date(),
        metadata: {
          service: 'checkout-service',
          timeStamp: new Date().toISOString(),
        },
      };

      await this.rabbitMQService.publishMessage(
        this.EXCHANGE, // para onde vou enviar
        this.ROUTING_KEY, // Como rotear
        enrichmentMessage, // o que enviar
      );

      this.logger.log(
        `✅ Payment order published sucessfully: ` +
          `orderId=${paymentOrder.orderId}` +
          `amount=${paymentOrder.amount}` +
          `userId=${paymentOrder.userId}`,
      );

      this.logger.debug(
        `Payment order details: ${JSON.stringify(enrichmentMessage)}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to publish payment order: orderId=${paymentOrder.orderId}:`,
        error,
      );
      throw error;
    }
  }

  // valido o conteudo da ordem de pagamento
  private validatePaymentOrder(paymentOrder: PaymentOrderMessage): boolean {
    if (!paymentOrder.orderId) {
      this.logger.error('❌ Invalid payment order: missing orderId');

      return false;
    }

    if (!paymentOrder.userId) {
      this.logger.error('❌ Invalid payment order: missing userId');

      return false;
    }

    if (!paymentOrder.amount || paymentOrder.amount <= 0) {
      this.logger.error('❌ Invalid payment order: invalid amount');

      return false;
    }

    if (!paymentOrder.items || paymentOrder.items.length === 0) {
      this.logger.error('❌ Invalid payment order: no items');

      return false;
    }

    return true;
  }

  // essa função chama a verificação do payment Order e se estiver tudo Ok, publica a order
  async publishPaymentOrderSafe(
    paymentOrder: PaymentOrderMessage,
  ): Promise<void> {
    if (!this.validatePaymentOrder(paymentOrder)) {
      throw new Error('Invalid payment order');
    }

    await this.publishPaymentOrder(paymentOrder);
  }
}
