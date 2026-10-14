import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
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
import { toPaymentOrderMessage } from '../src/orders/mappers/payment-order-message.mapper';

// soma em centavos para não acumular erro de ponto flutuante
const sumCents = (values: number[]) =>
  values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;

// mesmas regras do validateMessage do PaymentConsumerService (payments-service)
const paymentsServiceAccepts = (message: PaymentOrderMessage) =>
  Boolean(message.orderId) &&
  Boolean(message.userId) &&
  Boolean(message.amount) &&
  message.amount > 0 &&
  Boolean(message.paymentMethod) &&
  Array.isArray(message.items) &&
  message.items.length > 0;

// usa o checkout-db real (docker-compose): valida o que sai do banco até a fila
describe('Mensagem de pagamento a partir das entidades (e2e)', () => {
  let app: INestApplication;
  let carts: Repository<Cart>;
  let cartItems: Repository<CartItem>;
  let orders: Repository<Order>;
  let orderItems: Repository<OrderItem>;
  const publishMessage = jest.fn();

  const userId = randomUUID();
  const products = [
    {
      productId: randomUUID(),
      productName: 'Teclado',
      price: 349.9,
      quantity: 1,
    },
    {
      productId: randomUUID(),
      productName: 'Mouse',
      price: 99.99,
      quantity: 2,
    },
  ];
  const total = sumCents(products.map((p) => p.price * p.quantity));

  let cartId: string;
  let orderId: string;
  let orderCreatedAt: Date;
  // o que de fato trafega no RabbitMQ (JSON)
  let wire: Record<string, unknown>;
  let message: PaymentOrderMessage;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
        TypeOrmModule.forFeature([Cart, CartItem, Order, OrderItem]),
      ],
      providers: [
        PaymentQueueService,
        { provide: RabbitmqService, useValue: { publishMessage } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    carts = app.get(getRepositoryToken(Cart));
    cartItems = app.get(getRepositoryToken(CartItem));
    orders = app.get(getRepositoryToken(Order));
    orderItems = app.get(getRepositoryToken(OrderItem));

    // cascade: os itens são salvos junto com o carrinho
    const cart = await carts.save(
      carts.create({
        userId,
        status: CartStatus.COMPLETED,
        total,
        items: products.map((p) => ({
          ...p,
          subtotal: sumCents([p.price * p.quantity]),
        })),
      }),
    );
    cartId = cart.id;

    // o pedido copia os itens do carrinho no fechamento (cascade em items)
    const order = await orders.save(
      orders.create({
        userId,
        cartId,
        total: cart.total,
        paymentMethod: 'credit_card',
        items: cart.items.map(
          ({ productId, productName, price, quantity, subtotal }) => ({
            productId,
            productName,
            price,
            quantity,
            subtotal,
          }),
        ),
      }),
    );
    orderId = order.id;

    // o carrinho muda depois do pedido: a mensagem não pode mudar junto
    await cartItems.update({ cartId }, { price: 1, subtotal: 1 });

    // relê do banco: decimais passam pelo transformer e itens vêm por eager
    const savedOrder = await orders.findOneByOrFail({ id: orderId });
    orderCreatedAt = savedOrder.createdAt;

    // Safe: valida o pedido (inclusive amount × itens) antes de publicar
    await app
      .get(PaymentQueueService)
      .publishPaymentOrderSafe(toPaymentOrderMessage(savedOrder));

    message = (
      publishMessage.mock.calls[0] as unknown[]
    )[2] as PaymentOrderMessage;
    wire = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
  });

  afterAll(async () => {
    // ON DELETE CASCADE remove os itens do pedido e do carrinho
    await orders?.delete({ id: orderId });
    await carts?.delete({ id: cartId });
    await app?.close();
  });

  it('publica na exchange payments com a routing key payment.order', () => {
    expect(publishMessage).toHaveBeenCalledWith(
      'payments',
      'payment.order',
      expect.any(Object),
    );
  });

  it('envia exatamente os campos do contrato', () => {
    expect(Object.keys(wire).sort()).toEqual(
      [
        'amount',
        'createdAt',
        'items',
        'metadata',
        'orderId',
        'paymentMethod',
        'userId',
      ].sort(),
    );
  });

  it('identifica o pedido e o comprador com os UUIDs do Order', () => {
    expect(wire.orderId).toBe(orderId);
    expect(wire.userId).toBe(userId);
  });

  it('amount é número (não string do decimal) e igual ao total do pedido', () => {
    expect(typeof wire.amount).toBe('number');
    expect(wire.amount).toBe(total);
  });

  it('cada item tem só productId, quantity e price, todos tipados corretamente', () => {
    const items = wire.items as Record<string, unknown>[];

    expect(items).toHaveLength(products.length);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['price', 'productId', 'quantity'].sort(),
      );
      expect(typeof item.productId).toBe('string');
      expect(typeof item.quantity).toBe('number');
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect(typeof item.price).toBe('number');
    }
  });

  it('os itens vêm do pedido, não do carrinho alterado depois do fechamento', () => {
    expect(wire.items).toEqual(
      expect.arrayContaining(
        products.map(({ productId, quantity, price }) => ({
          productId,
          quantity,
          price,
        })),
      ),
    );
  });

  it('amount é igual à soma de price × quantity dos itens', () => {
    const items = wire.items as { price: number; quantity: number }[];

    expect(sumCents(items.map((i) => i.price * i.quantity))).toBe(wire.amount);
  });

  it('paymentMethod cabe na coluna varchar(50) e chega preenchido', () => {
    expect(wire.paymentMethod).toBe('credit_card');
    expect((wire.paymentMethod as string).length).toBeLessThanOrEqual(50);
  });

  it('createdAt é a data de criação do pedido, em ISO 8601', () => {
    expect(message.createdAt).toBe(orderCreatedAt.toISOString());
    expect(wire.createdAt).toBe(message.createdAt);
  });

  it('metadata identifica o checkout-service', () => {
    expect(wire.metadata).toEqual({
      service: 'checkout-service',
      timeStamp: expect.any(String),
    });
  });

  it('o pedido salvo continua pending (o pagamento ainda não foi processado)', async () => {
    const saved = await orders.findOneByOrFail({ id: orderId });
    expect(saved.status).toBe(OrderStatus.PENDING);
  });

  it('a mensagem passa nas validações do consumer do payments-service', () => {
    expect(paymentsServiceAccepts(message)).toBe(true);
  });

  it('apagar o pedido apaga os itens dele (ON DELETE CASCADE)', async () => {
    const extra = await orders.save(
      orders.create({
        userId,
        cartId,
        total: 10,
        paymentMethod: 'pix',
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

    await orders.delete({ id: extra.id });

    expect(await orderItems.countBy({ orderId: extra.id })).toBe(0);
  });
});
