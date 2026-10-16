import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, DeepPartial } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { Cart } from '../cart/entities/cart.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { CartStatus } from '../cart/enums/cart-status.enum';
import { PaymentOrderMessage } from '../events/payment-queue.interface';
import { PaymentQueueService } from '../events/payment-queue/payment-queue.service';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './enums/order-status.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { EMPTY_CART, ORDER_NOT_FOUND, OrdersService } from './orders.service';

const userId: string = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
const cartId: string = '6f1c2b0e-8a4d-4f7e-9b1a-2d3c4e5f6a7b';
const orderId: string = '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f';
const createdAt: Date = new Date('2026-10-14T20:00:00.000Z');

const makeCartItem = (data: Partial<CartItem>): CartItem =>
  Object.assign(new CartItem(), {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    cartId,
    productId: 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f',
    productName: 'Teclado',
    price: 19.99,
    quantity: 3,
    subtotal: 59.97,
    createdAt,
    ...data,
  });

const makeCart = (items: CartItem[]): Cart =>
  Object.assign(new Cart(), {
    id: cartId,
    userId,
    status: CartStatus.ACTIVE,
    total: 0,
    items,
    createdAt,
    updatedAt: createdAt,
  });

// pedido "gravado": o que o repositório devolve depois do commit
const makeSavedOrder = (data: DeepPartial<Order>): Order =>
  Object.assign(new Order(), {
    ...data,
    id: orderId,
    status: OrderStatus.PENDING,
    items: ((data.items ?? []) as DeepPartial<OrderItem>[]).map(
      (item: DeepPartial<OrderItem>, index: number): OrderItem =>
        Object.assign(new OrderItem(), {
          ...item,
          id: `item-${index}`,
          orderId,
          createdAt,
        }),
    ),
    createdAt,
    updatedAt: createdAt,
  });

describe('OrdersService', () => {
  let service: OrdersService;
  let created: DeepPartial<Order> | undefined;

  const manager: {
    create: jest.Mock;
    save: jest.Mock;
  } = {
    create: jest.fn(),
    save: jest.fn(),
  };
  const dataSource: { transaction: jest.Mock } = {
    transaction: jest.fn(
      (cb: (m: typeof manager) => Promise<unknown>): Promise<unknown> =>
        cb(manager),
    ),
  };
  const repository: {
    findOneByOrFail: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  } = {
    findOneByOrFail: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const cartService: {
    findActiveCartForCheckout: jest.Mock;
    completeCart: jest.Mock;
  } = {
    findActiveCartForCheckout: jest.fn(),
    completeCart: jest.fn(),
  };
  const paymentQueue: { publishPaymentOrderSafe: jest.Mock } = {
    publishPaymentOrderSafe: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    created = undefined;
    manager.create.mockImplementation(
      (_: unknown, data: DeepPartial<Order>): DeepPartial<Order> => {
        created = data;
        return { ...data };
      },
    );
    manager.save.mockImplementation((order: DeepPartial<Order>): Order =>
      makeSavedOrder(order),
    );
    repository.findOneByOrFail.mockImplementation((): Order =>
      makeSavedOrder(created ?? {}),
    );
    cartService.completeCart.mockResolvedValue(undefined);
    paymentQueue.publishPaymentOrderSafe.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: repository },
        { provide: DataSource, useValue: dataSource },
        { provide: CartService, useValue: cartService },
        { provide: PaymentQueueService, useValue: paymentQueue },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('checkout', () => {
    it('cria o pedido pending com cópia dos itens, conclui o carrinho e publica', async () => {
      const items: CartItem[] = [
        makeCartItem({}),
        makeCartItem({
          id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
          productId: 'd0e9f8a7-b6c5-4d4e-9f2a-1b0c9d8e7f6a',
          productName: 'Mouse',
          price: 25,
          quantity: 1,
          subtotal: 25,
        }),
      ];
      cartService.findActiveCartForCheckout.mockResolvedValue(makeCart(items));

      const result: OrderResponseDto = await service.checkout(userId, {
        paymentMethod: PaymentMethod.PIX,
      });

      expect(cartService.findActiveCartForCheckout).toHaveBeenCalledWith(
        manager,
        userId,
      );
      expect(created).toStrictEqual({
        userId,
        cartId,
        total: 84.97,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
        items: items.map(
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
        ),
      });
      expect(cartService.completeCart).toHaveBeenCalledWith(manager, cartId);
      expect(repository.findOneByOrFail).toHaveBeenCalledWith({ id: orderId });

      const message: PaymentOrderMessage = (
        paymentQueue.publishPaymentOrderSafe.mock
          .calls[0] as PaymentOrderMessage[]
      )[0];
      expect(message).toStrictEqual({
        orderId,
        userId,
        amount: 84.97,
        items: [
          {
            productId: items[0].productId,
            quantity: 3,
            price: 19.99,
          },
          { productId: items[1].productId, quantity: 1, price: 25 },
        ],
        paymentMethod: PaymentMethod.PIX,
        createdAt: createdAt.toISOString(),
      });

      expect(result.id).toBe(orderId);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.total).toBe(84.97);
      expect(result.items).toHaveLength(2);
    });

    it('publica só depois da transação', async () => {
      const calls: string[] = [];
      cartService.findActiveCartForCheckout.mockResolvedValue(
        makeCart([makeCartItem({})]),
      );
      dataSource.transaction.mockImplementationOnce(
        async (
          cb: (m: typeof manager) => Promise<unknown>,
        ): Promise<unknown> => {
          const result: unknown = await cb(manager);
          calls.push('commit');
          return result;
        },
      );
      paymentQueue.publishPaymentOrderSafe.mockImplementation(
        (): Promise<void> => {
          calls.push('publish');
          return Promise.resolve();
        },
      );

      await service.checkout(userId, { paymentMethod: PaymentMethod.BOLETO });

      expect(calls).toEqual(['commit', 'publish']);
    });

    it.each<[string, Cart | null]>([
      ['sem carrinho ativo', null],
      ['carrinho sem itens', makeCart([])],
    ])(
      '%s → 400 Carrinho vazio, sem pedido e sem publicar',
      async (_: string, cart: Cart | null) => {
        cartService.findActiveCartForCheckout.mockResolvedValue(cart);

        const promise: Promise<OrderResponseDto> = service.checkout(userId, {
          paymentMethod: PaymentMethod.PIX,
        });

        await expect(promise).rejects.toThrow(BadRequestException);
        await expect(promise).rejects.toThrow(EMPTY_CART);
        expect(manager.save).not.toHaveBeenCalled();
        expect(cartService.completeCart).not.toHaveBeenCalled();
        expect(paymentQueue.publishPaymentOrderSafe).not.toHaveBeenCalled();
      },
    );

    it('soma em centavos: subtotais 0.10 e 0.20 geram total e amount 0.3', async () => {
      cartService.findActiveCartForCheckout.mockResolvedValue(
        makeCart([
          makeCartItem({ price: 0.1, quantity: 1, subtotal: 0.1 }),
          makeCartItem({
            productId: 'd0e9f8a7-b6c5-4d4e-9f2a-1b0c9d8e7f6a',
            price: 0.2,
            quantity: 1,
            subtotal: 0.2,
          }),
        ]),
      );

      const result: OrderResponseDto = await service.checkout(userId, {
        paymentMethod: PaymentMethod.PIX,
      });

      expect(result.total).toBe(0.3);
      const message: PaymentOrderMessage = (
        paymentQueue.publishPaymentOrderSafe.mock
          .calls[0] as PaymentOrderMessage[]
      )[0];
      expect(message.amount).toBe(0.3);
    });

    it('falha na gravação: erro propaga, carrinho não é concluído e nada é publicado', async () => {
      cartService.findActiveCartForCheckout.mockResolvedValue(
        makeCart([makeCartItem({})]),
      );
      manager.save.mockRejectedValue(new Error('falha no banco'));

      await expect(
        service.checkout(userId, { paymentMethod: PaymentMethod.PIX }),
      ).rejects.toThrow('falha no banco');
      expect(cartService.completeCart).not.toHaveBeenCalled();
      expect(repository.findOneByOrFail).not.toHaveBeenCalled();
      expect(paymentQueue.publishPaymentOrderSafe).not.toHaveBeenCalled();
    });

    it('falha na publicação: responde o pedido e registra o erro com o orderId', async () => {
      const logError: jest.SpyInstance = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((): void => undefined);
      cartService.findActiveCartForCheckout.mockResolvedValue(
        makeCart([makeCartItem({})]),
      );
      paymentQueue.publishPaymentOrderSafe.mockRejectedValue(
        new Error('Invalid payment order'),
      );

      const result: OrderResponseDto = await service.checkout(userId, {
        paymentMethod: PaymentMethod.CREDIT_CARD,
      });

      expect(result.id).toBe(orderId);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(cartService.completeCart).toHaveBeenCalledWith(manager, cartId);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(`orderId=${orderId}`),
      );
      logError.mockRestore();
    });
  });

  describe('findAll', () => {
    it('busca os pedidos do usuário do mais recente para o mais antigo', async () => {
      const order: Order = makeSavedOrder({
        userId,
        cartId,
        total: 10,
        paymentMethod: PaymentMethod.PIX,
      });
      repository.find.mockResolvedValue([order]);

      const result: OrderResponseDto[] = await service.findAll(userId);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      expect(result.map((o: OrderResponseDto): string => o.id)).toEqual([
        orderId,
      ]);
    });

    it('sem pedidos devolve lista vazia', async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.findAll(userId)).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('busca filtrando pelo id e pelo dono', async () => {
      repository.findOne.mockResolvedValue(
        makeSavedOrder({
          userId,
          cartId,
          total: 10,
          paymentMethod: PaymentMethod.PIX,
        }),
      );

      const result: OrderResponseDto = await service.findOne(userId, orderId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: orderId, userId },
      });
      expect(result.id).toBe(orderId);
    });

    it('pedido inexistente ou de outro usuário → 404 Pedido não encontrado', async () => {
      repository.findOne.mockResolvedValue(null);

      const promise: Promise<OrderResponseDto> = service.findOne(
        userId,
        orderId,
      );

      await expect(promise).rejects.toThrow(NotFoundException);
      await expect(promise).rejects.toThrow(ORDER_NOT_FOUND);
    });
  });
});
