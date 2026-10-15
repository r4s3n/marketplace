import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, DeepPartial, EntityManager, Repository } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { Cart } from '../cart/entities/cart.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { sumMoney } from '../common/utils/money';
import { PaymentQueueService } from '../events/payment-queue/payment-queue.service';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './enums/order-status.enum';
import { toOrderResponse } from './mappers/order-response.mapper';
import { toPaymentOrderMessage } from './mappers/payment-order-message.mapper';

export const EMPTY_CART: string = 'Carrinho vazio';
export const ORDER_NOT_FOUND: string = 'Pedido não encontrado';

@Injectable()
export class OrdersService {
  private readonly logger: Logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly paymentQueue: PaymentQueueService,
  ) {}

  async checkout(
    userId: string,
    { paymentMethod }: CheckoutDto,
  ): Promise<OrderResponseDto> {
    // pedido, itens e carrinho completed: tudo ou nada
    const orderId: string = await this.dataSource.transaction(
      async (manager: EntityManager): Promise<string> => {
        const cart: Cart | null =
          await this.cartService.findActiveCartForCheckout(manager, userId);
        if (!cart || cart.items.length === 0) {
          throw new BadRequestException(EMPTY_CART);
        }

        // cópia dos itens: o pedido não muda se o carrinho ou o produto mudar
        const items: DeepPartial<OrderItem>[] = cart.items.map(
          ({
            productId,
            productName,
            price,
            quantity,
            subtotal,
          }: CartItem): DeepPartial<OrderItem> => ({
            productId,
            productName,
            price,
            quantity,
            subtotal,
          }),
        );
        const order: Order = manager.create(Order, {
          userId,
          cartId: cart.id,
          total: sumMoney(
            cart.items.map((item: CartItem): number => item.subtotal),
          ),
          status: OrderStatus.PENDING,
          paymentMethod,
          items,
        });
        const saved: Order = await manager.save(order); // cascade grava os itens

        await this.cartService.completeCart(manager, cart.id);
        return saved.id;
      },
    );

    // relido depois do commit: a mensagem só sai com o pedido já gravado
    const order: Order = await this.orders.findOneByOrFail({ id: orderId });
    this.logger.log(
      `🧾 Order created: orderId=${order.id} userId=${order.userId} total=${order.total}`,
    );

    await this.publishPayment(order);
    return toOrderResponse(order);
  }

  async findAll(userId: string): Promise<OrderResponseDto[]> {
    const orders: Order[] = await this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return orders.map(toOrderResponse);
  }

  // filtrar pelo userId garante a posse: pedido de outro usuário vira 404
  async findOne(userId: string, id: string): Promise<OrderResponseDto> {
    const order: Order | null = await this.orders.findOne({
      where: { id, userId },
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    return toOrderResponse(order);
  }

  // falha na publicação não desfaz o pedido: ele fica pending e o erro vai pro log
  private async publishPayment(order: Order): Promise<void> {
    try {
      await this.paymentQueue.publishPaymentOrderSafe(
        toPaymentOrderMessage(order),
      );
    } catch (error: unknown) {
      const reason: string =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `❌ Failed to publish payment order: orderId=${order.id} reason=${reason}`,
      );
    }
  }
}
