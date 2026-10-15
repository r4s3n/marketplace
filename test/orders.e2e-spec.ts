import {
  INestApplication,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { UserRole } from '../src/auth/enums/user-role.enum';
import { CartModule } from '../src/cart/cart.module';
import { Cart } from '../src/cart/entities/cart.entity';
import { CartItem } from '../src/cart/entities/cart-item.entity';
import { CartStatus } from '../src/cart/enums/cart-status.enum';
import { databaseConfig } from '../src/config/database.config';
import { PaymentOrderMessage } from '../src/events/payment-queue.interface';
import { PaymentQueueService } from '../src/events/payment-queue/payment-queue.service';
import { RabbitmqService } from '../src/events/rabbitmq/rabbitmq.service';
import { Order } from '../src/orders/entities/order.entity';
import { OrderItem } from '../src/orders/entities/order-item.entity';
import { OrderStatus } from '../src/orders/enums/order-status.enum';
import { PaymentMethod } from '../src/orders/enums/payment-method.enum';
import { OrdersModule } from '../src/orders/orders.module';
import { Product } from '../src/products-client/interfaces/product.interface';
import { ProductsClientService } from '../src/products-client/products-client.service';

type TestUser = { id: string; role: UserRole };

type OrderItemBody = {
  id: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  subtotal: number;
  createdAt: string;
};

type OrderBody = {
  id: string;
  userId: string;
  cartId: string;
  total: number;
  status: string;
  paymentMethod: string;
  items: OrderItemBody[];
  createdAt: string;
  updatedAt: string;
};

type CartBody = {
  id: string | null;
  status: string;
  total: number;
  items: Omit<OrderItemBody, 'createdAt'>[];
};

const PAYMENT_METHOD_MESSAGE: string =
  'paymentMethod deve ser um dos valores: credit_card, debit_card, pix, boleto';

const ORDER_KEYS: string[] = [
  'cartId',
  'createdAt',
  'id',
  'items',
  'paymentMethod',
  'status',
  'total',
  'updatedAt',
  'userId',
].sort();

const ITEM_KEYS: string[] = [
  'createdAt',
  'id',
  'price',
  'productId',
  'productName',
  'quantity',
  'subtotal',
].sort();

const makeProduct = (data: Partial<Product> = {}): Product => ({
  id: randomUUID(),
  name: 'Teclado mecânico',
  price: 19.99,
  stock: 10,
  isActive: true,
  sellerId: randomUUID(),
  ...data,
});

const byProductId = <T extends { productId: string }>(a: T, b: T): number =>
  a.productId.localeCompare(b.productId);

// usa o checkout-db real (docker-compose); products-service e RabbitMQ são simulados
describe('Pedidos (e2e)', () => {
  let app: INestApplication<App>;
  let carts: Repository<Cart>;
  let cartItems: Repository<CartItem>;
  let orders: Repository<Order>;
  let orderItems: Repository<OrderItem>;
  let jwt: JwtService;

  // catálogo simulado: getProduct responde a partir deste mapa
  const catalog: Map<string, Product> = new Map<string, Product>();
  const getProduct: jest.Mock<Promise<Product>, [string]> = jest.fn(
    (id: string): Promise<Product> => {
      const product: Product | undefined = catalog.get(id);
      return product
        ? Promise.resolve({ ...product })
        : Promise.reject(new NotFoundException('Produto não encontrado'));
    },
  );
  const publishPaymentOrderSafe: jest.Mock<
    Promise<void>,
    [PaymentOrderMessage]
  > = jest.fn((): Promise<void> => Promise.resolve());

  const buyer: TestUser = { id: randomUUID(), role: UserRole.BUYER };
  const seller: TestUser = { id: randomUUID(), role: UserRole.SELLER };
  const otherBuyer: TestUser = { id: randomUUID(), role: UserRole.BUYER };

  const tokenOf = (user: TestUser): string =>
    `Bearer ${jwt.sign(
      { sub: user.id, email: `${user.id}@example.com`, role: user.role },
      { expiresIn: 3600 },
    )}`;

  const addProduct = (data: Partial<Product> = {}): Product => {
    const product: Product = makeProduct(data);
    catalog.set(product.id, product);
    return product;
  };

  const addItem = (
    productId: string,
    quantity: number,
    user: TestUser = buyer,
  ): request.Test =>
    request(app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', tokenOf(user))
      .send({ productId, quantity });

  const getCart = (user: TestUser = buyer): request.Test =>
    request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', tokenOf(user));

  const checkout = (body: object, user: TestUser = buyer): request.Test =>
    request(app.getHttpServer())
      .post('/cart/checkout')
      .set('Authorization', tokenOf(user))
      .send(body);

  const listOrders = (user: TestUser = buyer): request.Test =>
    request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', tokenOf(user));

  const getOrder = (id: string, user: TestUser = buyer): request.Test =>
    request(app.getHttpServer())
      .get(`/orders/${id}`)
      .set('Authorization', tokenOf(user));

  // monta um carrinho com dois itens (59.97 + 25.00) e devolve o carrinho
  const fillCart = async (user: TestUser = buyer): Promise<CartBody> => {
    const keyboard: Product = addProduct({ name: 'Teclado', price: 19.99 });
    const mouse: Product = addProduct({ name: 'Mouse', price: 25 });
    await addItem(keyboard.id, 3, user).expect(201);
    const res: request.Response = await addItem(mouse.id, 1, user).expect(201);
    return res.body as CartBody;
  };

  const lastMessage = (): PaymentOrderMessage =>
    publishPaymentOrderSafe.mock.calls[
      publishPaymentOrderSafe.mock.calls.length - 1
    ][0];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
        AuthModule,
        CartModule,
        OrdersModule,
      ],
    })
      .overrideProvider(ProductsClientService)
      .useValue({ getProduct })
      .overrideProvider(PaymentQueueService)
      .useValue({ publishPaymentOrderSafe })
      .overrideProvider(RabbitmqService) // não conecta no RabbitMQ
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    // mesmo ValidationPipe do main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    carts = app.get(getRepositoryToken(Cart));
    cartItems = app.get(getRepositoryToken(CartItem));
    orders = app.get(getRepositoryToken(Order));
    orderItems = app.get(getRepositoryToken(OrderItem));
    // mesmo secret do users-service, lido do .env
    jwt = new JwtService({
      secret: app.get(ConfigService).getOrThrow<string>('JWT_SECRET'),
    });
  });

  afterEach(async () => {
    const userIds: string[] = [buyer.id, seller.id, otherBuyer.id];
    // ON DELETE CASCADE remove os itens
    await orders.delete({ userId: In(userIds) });
    await carts.delete({ userId: In(userIds) });
    catalog.clear();
    getProduct.mockClear();
    publishPaymentOrderSafe.mockReset();
    publishPaymentOrderSafe.mockImplementation((): Promise<void> =>
      Promise.resolve(),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('autenticação', () => {
    it('as três rotas sem token → 401', async () => {
      const server: App = app.getHttpServer();
      await request(server)
        .post('/cart/checkout')
        .send({ paymentMethod: PaymentMethod.PIX })
        .expect(401);
      await request(server).get('/orders').expect(401);
      await request(server).get(`/orders/${randomUUID()}`).expect(401);
    });
  });

  describe('POST /cart/checkout', () => {
    it('cria o pedido pending com os itens do carrinho (CA-02, CA-03)', async () => {
      const cart: CartBody = await fillCart();

      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.PIX,
      }).expect(201);
      const body: OrderBody = res.body as OrderBody;

      expect(Object.keys(body).sort()).toEqual(ORDER_KEYS);
      expect(body).toMatchObject({
        userId: buyer.id,
        cartId: cart.id,
        total: 84.97,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
      });
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      }
      expect(
        body.items
          .map(
            ({
              productId,
              productName,
              price,
              quantity,
              subtotal,
            }: OrderItemBody): Omit<OrderItemBody, 'id' | 'createdAt'> => ({
              productId,
              productName,
              price,
              quantity,
              subtotal,
            }),
          )
          .sort(byProductId),
      ).toEqual(
        cart.items
          .map(
            ({
              productId,
              productName,
              price,
              quantity,
              subtotal,
            }: Omit<OrderItemBody, 'createdAt'>): Omit<
              OrderItemBody,
              'id' | 'createdAt'
            > => ({ productId, productName, price, quantity, subtotal }),
          )
          .sort(byProductId),
      );
    });

    it('grava pedido e itens e conclui o carrinho mantendo os itens (CA-04, CA-05)', async () => {
      const cart: CartBody = await fillCart();

      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.CREDIT_CARD,
      }).expect(201);
      const body: OrderBody = res.body as OrderBody;

      expect(await orders.countBy({ userId: buyer.id })).toBe(1);
      expect(await orderItems.countBy({ orderId: body.id })).toBe(2);
      const saved: Order = await orders.findOneByOrFail({ id: body.id });
      expect(saved.total).toBe(body.total);

      const savedCart: Cart = await carts.findOneByOrFail({
        id: cart.id as string,
      });
      expect(savedCart.status).toBe(CartStatus.COMPLETED);
      expect(savedCart.total).toBe(84.97);
      expect(await cartItems.countBy({ cartId: cart.id as string })).toBe(2);
    });

    it('depois do checkout o carrinho some e uma nova adição cria outro (CA-06)', async () => {
      const cart: CartBody = await fillCart();
      await checkout({ paymentMethod: PaymentMethod.PIX }).expect(201);

      const empty: request.Response = await getCart().expect(200);
      expect((empty.body as CartBody).id).toBeNull();

      const product: Product = addProduct();
      const res: request.Response = await addItem(product.id, 1).expect(201);
      const newCart: CartBody = res.body as CartBody;
      expect(newCart.id).not.toBe(cart.id);
      expect(newCart.status).toBe(CartStatus.ACTIVE);
    });

    it.each<PaymentMethod>(Object.values(PaymentMethod))(
      'aceita paymentMethod %s (CA-07)',
      async (paymentMethod: PaymentMethod) => {
        await fillCart();

        const res: request.Response = await checkout({ paymentMethod }).expect(
          201,
        );
        const body: OrderBody = res.body as OrderBody;

        expect(body.paymentMethod).toBe(paymentMethod);
        const saved: Order = await orders.findOneByOrFail({ id: body.id });
        expect(saved.paymentMethod).toBe(paymentMethod);
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['ausente', {}],
      ['paypal', { paymentMethod: 'paypal' }],
      ['maiúsculo', { paymentMethod: 'PIX' }],
      ['número', { paymentMethod: 1 }],
      ['vazio', { paymentMethod: '' }],
    ])(
      'paymentMethod %s → 400 sem criar pedido (CA-08)',
      async (_: string, body: Record<string, unknown>) => {
        const cart: CartBody = await fillCart();

        const res: request.Response = await checkout(body).expect(400);

        expect((res.body as { message: string[] }).message).toContain(
          PAYMENT_METHOD_MESSAGE,
        );
        expect(await orders.countBy({ userId: buyer.id })).toBe(0);
        const savedCart: Cart = await carts.findOneByOrFail({
          id: cart.id as string,
        });
        expect(savedCart.status).toBe(CartStatus.ACTIVE);
        expect(publishPaymentOrderSafe).not.toHaveBeenCalled();
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['userId', { userId: randomUUID() }],
      ['cartId', { cartId: randomUUID() }],
      ['total', { total: 1 }],
      ['status', { status: OrderStatus.PAID }],
      ['items', { items: [] }],
    ])(
      'corpo com %s → 400 sem criar pedido (CA-09)',
      async (_: string, extra: Record<string, unknown>) => {
        await fillCart();

        await checkout({ paymentMethod: PaymentMethod.PIX, ...extra }).expect(
          400,
        );

        expect(await orders.countBy({ userId: buyer.id })).toBe(0);
      },
    );

    it('sem carrinho ativo → 400 Carrinho vazio, sem publicar (CA-10)', async () => {
      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.PIX,
      }).expect(400);

      expect((res.body as { message: string }).message).toBe('Carrinho vazio');
      expect(await orders.countBy({ userId: buyer.id })).toBe(0);
      expect(publishPaymentOrderSafe).not.toHaveBeenCalled();
    });

    it('carrinho ativo sem itens → 400 e o carrinho continua active (CA-11)', async () => {
      const product: Product = addProduct();
      const added: request.Response = await addItem(product.id, 1).expect(201);
      const cart: CartBody = added.body as CartBody;
      await request(app.getHttpServer())
        .delete(`/cart/items/${cart.items[0].id}`)
        .set('Authorization', tokenOf(buyer))
        .expect(200);

      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.PIX,
      }).expect(400);

      expect((res.body as { message: string }).message).toBe('Carrinho vazio');
      const savedCart: Cart = await carts.findOneByOrFail({
        id: cart.id as string,
      });
      expect(savedCart.status).toBe(CartStatus.ACTIVE);
      expect(await orders.countBy({ userId: buyer.id })).toBe(0);
    });

    it('só com carrinho completed → 400 Carrinho vazio (CA-12)', async () => {
      await carts.save(
        carts.create({
          userId: buyer.id,
          status: CartStatus.COMPLETED,
          total: 10,
          items: [
            {
              productId: randomUUID(),
              productName: 'Cabo',
              price: 10,
              quantity: 1,
              subtotal: 10,
            },
          ],
        }),
      );

      await checkout({ paymentMethod: PaymentMethod.PIX }).expect(400);
      expect(await orders.countBy({ userId: buyer.id })).toBe(0);
    });

    it('publica uma mensagem com os dados do pedido (CA-13)', async () => {
      await fillCart();

      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.DEBIT_CARD,
      }).expect(201);
      const body: OrderBody = res.body as OrderBody;

      expect(publishPaymentOrderSafe).toHaveBeenCalledTimes(1);
      const message: PaymentOrderMessage = lastMessage();
      expect(message).toMatchObject({
        orderId: body.id,
        userId: buyer.id,
        amount: body.total,
        paymentMethod: PaymentMethod.DEBIT_CARD,
        createdAt: body.createdAt,
      });
      expect([...message.items].sort(byProductId)).toEqual(
        body.items
          .map(
            ({
              productId,
              quantity,
              price,
            }: OrderItemBody): PaymentOrderMessage['items'][number] => ({
              productId,
              quantity,
              price,
            }),
          )
          .sort(byProductId),
      );
    });

    it('publica com o pedido já gravado no banco (CA-14)', async () => {
      let foundStatus: OrderStatus | undefined;
      publishPaymentOrderSafe.mockImplementation(
        async (message: PaymentOrderMessage): Promise<void> => {
          const order: Order | null = await orders.findOneBy({
            id: message.orderId,
          });
          foundStatus = order?.status;
        },
      );
      await fillCart();

      await checkout({ paymentMethod: PaymentMethod.PIX }).expect(201);

      expect(foundStatus).toBe(OrderStatus.PENDING);
    });

    it('publicação falhando → 201, pedido pending, carrinho completed e log (CA-15)', async () => {
      const logError: jest.SpyInstance = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((): void => undefined);
      publishPaymentOrderSafe.mockRejectedValue(new Error('RabbitMQ fora'));
      const cart: CartBody = await fillCart();

      const res: request.Response = await checkout({
        paymentMethod: PaymentMethod.PIX,
      }).expect(201);
      const body: OrderBody = res.body as OrderBody;

      expect(body.status).toBe(OrderStatus.PENDING);
      const saved: Order = await orders.findOneByOrFail({ id: body.id });
      expect(saved.status).toBe(OrderStatus.PENDING);
      const savedCart: Cart = await carts.findOneByOrFail({
        id: cart.id as string,
      });
      expect(savedCart.status).toBe(CartStatus.COMPLETED);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(`orderId=${body.id}`),
      );
      logError.mockRestore();
    });

    it('dois checkouts simultâneos → um 201, um 400 e um único pedido (CA-17)', async () => {
      await fillCart();

      const responses: request.Response[] = await Promise.all([
        checkout({ paymentMethod: PaymentMethod.PIX }),
        checkout({ paymentMethod: PaymentMethod.PIX }),
      ]);

      expect(
        responses.map((res: request.Response): number => res.status).sort(),
      ).toEqual([201, 400]);
      expect(await orders.countBy({ userId: buyer.id })).toBe(1);
      expect(publishPaymentOrderSafe).toHaveBeenCalledTimes(1);
    });

    it('não mexe no carrinho de outro usuário (CA-19)', async () => {
      await fillCart(buyer);
      const other: CartBody = await fillCart(otherBuyer);

      await checkout({ paymentMethod: PaymentMethod.PIX }, buyer).expect(201);

      const otherCart: Cart = await carts.findOneByOrFail({
        id: other.id as string,
      });
      expect(otherCart.status).toBe(CartStatus.ACTIVE);
      expect(await orders.countBy({ userId: otherBuyer.id })).toBe(0);
    });

    it('não chama o products-service (CA-20)', async () => {
      await fillCart();
      getProduct.mockClear();

      await checkout({ paymentMethod: PaymentMethod.PIX }).expect(201);

      expect(getProduct).not.toHaveBeenCalled();
    });

    it('seller e buyer finalizam o próprio carrinho (CA-21)', async () => {
      for (const user of [buyer, seller]) {
        await fillCart(user);
        const res: request.Response = await checkout(
          { paymentMethod: PaymentMethod.PIX },
          user,
        ).expect(201);
        expect((res.body as OrderBody).userId).toBe(user.id);
      }
    });
  });

  describe('GET /orders', () => {
    it('sem pedidos → 200 com lista vazia (CA-23)', async () => {
      const res: request.Response = await listOrders().expect(200);

      expect(res.body).toEqual([]);
    });

    it('lista do mais recente para o mais antigo, com itens e números (CA-24, CA-26)', async () => {
      const ids: string[] = [];
      for (let i: number = 0; i < 3; i++) {
        await fillCart();
        const res: request.Response = await checkout({
          paymentMethod: PaymentMethod.PIX,
        }).expect(201);
        ids.push((res.body as OrderBody).id);
      }

      const res: request.Response = await listOrders().expect(200);
      const body: OrderBody[] = res.body as OrderBody[];

      expect(body.map((order: OrderBody): string => order.id)).toEqual(
        [...ids].reverse(),
      );
      for (const order of body) {
        expect(Object.keys(order).sort()).toEqual(ORDER_KEYS);
        expect(order.items).toHaveLength(2);
        expect(typeof order.total).toBe('number');
        for (const item of order.items) {
          expect(typeof item.price).toBe('number');
          expect(typeof item.subtotal).toBe('number');
        }
      }
    });

    it('não mostra pedidos de outro usuário (CA-25)', async () => {
      await fillCart(otherBuyer);
      await checkout({ paymentMethod: PaymentMethod.PIX }, otherBuyer).expect(
        201,
      );

      const res: request.Response = await listOrders(buyer).expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('GET /orders/:id', () => {
    it('pedido do próprio usuário → 200 igual ao do checkout (CA-28)', async () => {
      await fillCart();
      const created: request.Response = await checkout({
        paymentMethod: PaymentMethod.BOLETO,
      }).expect(201);
      const order: OrderBody = created.body as OrderBody;

      const res: request.Response = await getOrder(order.id).expect(200);
      const body: OrderBody = res.body as OrderBody;

      expect({
        ...body,
        items: [...body.items].sort(byProductId),
      }).toEqual({ ...order, items: [...order.items].sort(byProductId) });
    });

    it('id não UUID → 400 (CA-29)', async () => {
      const res: request.Response = await getOrder('abc').expect(400);

      expect((res.body as { message: string }).message).toBe(
        'id deve ser um UUID válido',
      );
    });

    it('UUID sem pedido e pedido de outro usuário → mesmo 404 (CA-30, CA-31)', async () => {
      await fillCart(otherBuyer);
      const created: request.Response = await checkout(
        { paymentMethod: PaymentMethod.PIX },
        otherBuyer,
      ).expect(201);

      const missing: request.Response =
        await getOrder(randomUUID()).expect(404);
      const foreign: request.Response = await getOrder(
        (created.body as OrderBody).id,
        buyer,
      ).expect(404);

      expect(missing.body).toEqual({
        statusCode: 404,
        message: 'Pedido não encontrado',
        error: 'Not Found',
      });
      expect(foreign.body).toEqual(missing.body);
    });
  });
});
