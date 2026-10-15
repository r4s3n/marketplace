import {
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
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
import { Product } from '../src/products-client/interfaces/product.interface';
import { ProductsClientService } from '../src/products-client/products-client.service';

type CartBody = {
  id: string | null;
  userId: string;
  status: string;
  total: number;
  items: Record<string, unknown>[];
  createdAt: string | null;
  updatedAt: string | null;
};

const makeProduct = (data: Partial<Product> = {}): Product => ({
  id: randomUUID(),
  name: 'Teclado mecânico',
  price: 19.99,
  stock: 10,
  isActive: true,
  sellerId: randomUUID(),
  ...data,
});

// usa o checkout-db real (docker-compose); o products-service é simulado
describe('Carrinho (e2e)', () => {
  let app: INestApplication<App>;
  let carts: Repository<Cart>;
  let cartItems: Repository<CartItem>;
  let jwt: JwtService;

  // catálogo simulado: getProduct responde a partir deste mapa
  const catalog = new Map<string, Product>();
  const getProduct = jest.fn((id: string) => {
    const product = catalog.get(id);
    return product
      ? Promise.resolve({ ...product })
      : Promise.reject(new NotFoundException('Produto não encontrado'));
  });

  const buyer = { id: randomUUID(), role: UserRole.BUYER };
  const seller = { id: randomUUID(), role: UserRole.SELLER };
  const tokenOf = (user: { id: string; role: UserRole }) =>
    `Bearer ${jwt.sign(
      { sub: user.id, email: `${user.role}@example.com`, role: user.role },
      { expiresIn: 3600 },
    )}`;

  const getCart = (user = buyer) =>
    request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', tokenOf(user));

  const addItem = (body: object, user = buyer) =>
    request(app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', tokenOf(user))
      .send(body);

  const removeItem = (itemId: string, user = buyer) =>
    request(app.getHttpServer())
      .delete(`/cart/items/${itemId}`)
      .set('Authorization', tokenOf(user));

  const addProduct = (data: Partial<Product> = {}) => {
    const product = makeProduct(data);
    catalog.set(product.id, product);
    return product;
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
        AuthModule,
        CartModule,
      ],
    })
      .overrideProvider(ProductsClientService)
      .useValue({ getProduct })
      .compile();

    app = moduleFixture.createNestApplication();
    // mesmo ValidationPipe do main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        stopAtFirstError: true,
      }),
    );
    await app.init();

    carts = app.get(getRepositoryToken(Cart));
    cartItems = app.get(getRepositoryToken(CartItem));
    // mesmo secret do users-service, lido do .env
    jwt = new JwtService({
      secret: app.get(ConfigService).getOrThrow<string>('JWT_SECRET'),
    });
  });

  afterEach(async () => {
    // ON DELETE CASCADE remove os itens
    await carts.delete({ userId: In([buyer.id, seller.id]) });
    catalog.clear();
    getProduct.mockClear();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('autenticação', () => {
    it('as três rotas sem token → 401', async () => {
      const server = app.getHttpServer();
      await request(server).get('/cart').expect(401);
      await request(server)
        .post('/cart/items')
        .send({ productId: randomUUID(), quantity: 1 })
        .expect(401);
      await request(server).delete(`/cart/items/${randomUUID()}`).expect(401);
    });
  });

  describe('GET /cart', () => {
    it('sem carrinho → 200 com carrinho vazio e nada gravado no banco', async () => {
      const res = await getCart().expect(200);

      expect(res.body).toStrictEqual({
        id: null,
        userId: buyer.id,
        status: 'active',
        total: 0,
        items: [],
        createdAt: null,
        updatedAt: null,
      });
      await getCart().expect(200);
      expect(await carts.countBy({ userId: buyer.id })).toBe(0);
    });

    it('com itens → formato da RF-06, itens em ordem de entrada e números', async () => {
      const first = addProduct({ name: 'Teclado', price: 20 });
      const second = addProduct({ name: 'Mouse', price: 10.5 });
      await addItem({ productId: first.id, quantity: 1 }).expect(201);
      await addItem({ productId: second.id, quantity: 2 }).expect(201);
      getProduct.mockClear();

      const res = await getCart().expect(200);
      const body = res.body as CartBody;

      expect(Object.keys(body).sort()).toEqual(
        [
          'createdAt',
          'id',
          'items',
          'status',
          'total',
          'updatedAt',
          'userId',
        ].sort(),
      );
      expect(body.total).toBe(41);
      expect(body.items.map((i) => i.productName)).toEqual([
        'Teclado',
        'Mouse',
      ]);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(
          [
            'createdAt',
            'id',
            'price',
            'productId',
            'productName',
            'quantity',
            'subtotal',
          ].sort(),
        );
        expect(typeof item.price).toBe('number');
        expect(typeof item.subtotal).toBe('number');
      }
      // lê o snapshot gravado: não consulta o products-service
      expect(getProduct).not.toHaveBeenCalled();
    });

    it('só com carrinho completed → carrinho vazio', async () => {
      await carts.save(
        carts.create({
          userId: buyer.id,
          status: CartStatus.COMPLETED,
          total: 10,
        }),
      );

      const res = await getCart().expect(200);
      expect((res.body as CartBody).id).toBeNull();
      expect((res.body as CartBody).items).toEqual([]);
    });
  });

  describe('POST /cart/items', () => {
    it('primeira adição cria o carrinho com subtotal e total (3 × 19.99 = 59.97)', async () => {
      const product = addProduct({ price: 19.99 });

      const res = await addItem({ productId: product.id, quantity: 3 }).expect(
        201,
      );
      const body = res.body as CartBody;

      expect(body.id).toEqual(expect.any(String));
      expect(body.userId).toBe(buyer.id);
      expect(body.status).toBe('active');
      expect(body.total).toBe(59.97);
      expect(body.items).toEqual([
        expect.objectContaining({
          productId: product.id,
          productName: product.name,
          price: 19.99,
          quantity: 3,
          subtotal: 59.97,
        }),
      ]);
    });

    it('grava o snapshot de nome e preço e mantém carts.total igual à resposta', async () => {
      const product = addProduct({ name: 'Monitor', price: 899.9 });

      const res = await addItem({ productId: product.id, quantity: 2 }).expect(
        201,
      );
      const body = res.body as CartBody;

      const item = await cartItems.findOneByOrFail({ cartId: body.id! });
      expect(item.productName).toBe('Monitor');
      expect(item.price).toBe(899.9);
      const cart = await carts.findOneByOrFail({ id: body.id! });
      expect(cart.total).toBe(body.total);
      expect(cart.total).toBe(1799.8);
    });

    it('mesmo produto de novo soma a quantidade sem criar outro item', async () => {
      const product = addProduct({ price: 19.99 });
      await addItem({ productId: product.id, quantity: 3 }).expect(201);

      const res = await addItem({ productId: product.id, quantity: 2 }).expect(
        201,
      );
      const body = res.body as CartBody;

      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ quantity: 5, subtotal: 99.95 });
      expect(body.total).toBe(99.95);
      expect(await cartItems.countBy({ cartId: body.id! })).toBe(1);
    });

    it('preço mudou entre as adições → item usa o preço atual', async () => {
      const product = addProduct({ price: 19.99 });
      await addItem({ productId: product.id, quantity: 1 }).expect(201);
      catalog.set(product.id, { ...product, name: 'Teclado novo', price: 25 });

      const res = await addItem({ productId: product.id, quantity: 2 }).expect(
        201,
      );
      const body = res.body as CartBody;

      expect(body.items[0]).toMatchObject({
        productName: 'Teclado novo',
        price: 25,
        quantity: 3,
        subtotal: 75,
      });
      expect(body.total).toBe(75);
    });

    it('segundo produto cria um segundo item e total = soma dos subtotais', async () => {
      const a = addProduct({ price: 0.1 });
      const b = addProduct({ price: 0.2 });
      await addItem({ productId: a.id, quantity: 1 }).expect(201);

      const res = await addItem({ productId: b.id, quantity: 1 }).expect(201);
      const body = res.body as CartBody;

      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(0.3);
    });

    it('produto inexistente → 404 e nenhum carrinho criado', async () => {
      const res = await addItem({
        productId: randomUUID(),
        quantity: 1,
      }).expect(404);

      expect(res.body).toStrictEqual({
        statusCode: 404,
        message: 'Produto não encontrado',
        error: 'Not Found',
      });
      expect(await carts.countBy({ userId: buyer.id })).toBe(0);
    });

    it('produto inativo → 400 e nenhum carrinho criado', async () => {
      const product = addProduct({ isActive: false });

      const res = await addItem({ productId: product.id, quantity: 1 }).expect(
        400,
      );

      expect(res.body).toStrictEqual({
        statusCode: 400,
        message: 'Produto indisponível',
        error: 'Bad Request',
      });
      expect(await carts.countBy({ userId: buyer.id })).toBe(0);
    });

    it('products-service indisponível → 503 sem detalhes técnicos e nada gravado', async () => {
      getProduct.mockRejectedValueOnce(
        new ServiceUnavailableException('Serviço de produtos indisponível'),
      );

      const res = await addItem({
        productId: randomUUID(),
        quantity: 1,
      }).expect(503);

      expect(res.body).toStrictEqual({
        statusCode: 503,
        message: 'Serviço de produtos indisponível',
        error: 'Service Unavailable',
      });
      expect(await carts.countBy({ userId: buyer.id })).toBe(0);
    });

    it.each([[{ quantity: 1 }], [{ productId: 'nao-e-uuid', quantity: 1 }]])(
      'productId inválido %j → 400 sem chamar o products-service',
      async (body) => {
        const res = await addItem(body).expect(400);

        expect((res.body as { message: string[] }).message).toContain(
          'productId deve ser um UUID válido',
        );
        expect(getProduct).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, 0, -1, 1.5, '2'])(
      'quantity %p → 400 sem chamar o products-service',
      async (quantity) => {
        const res = await addItem({ productId: randomUUID(), quantity }).expect(
          400,
        );

        expect((res.body as { message: string[] }).message).toContain(
          'quantity deve ser um número inteiro maior ou igual a 1',
        );
        expect(getProduct).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, '2'])(
      'quantity %p → a mensagem aparece uma única vez',
      async (quantity) => {
        const res = await addItem({ productId: randomUUID(), quantity }).expect(
          400,
        );

        expect((res.body as { message: string[] }).message).toEqual([
          'quantity deve ser um número inteiro maior ou igual a 1',
        ]);
      },
    );

    it.each(['price', 'productName', 'userId', 'cartId'])(
      'campo extra %s no corpo → 400',
      async (field) => {
        const product = addProduct();

        await addItem({
          productId: product.id,
          quantity: 1,
          [field]: field === 'price' ? 0.01 : randomUUID(),
        }).expect(400);
        expect(await carts.countBy({ userId: buyer.id })).toBe(0);
      },
    );

    it('total acima do limite do decimal(10,2) → 400 e nada gravado', async () => {
      const product = addProduct({ price: 99999 });

      const res = await addItem({
        productId: product.id,
        quantity: 1001,
      }).expect(400);

      expect((res.body as { message: string }).message).toBe(
        'Quantidade excede o limite permitido',
      );
      const cart = await carts.findOneBy({ userId: buyer.id });
      expect(cart?.items ?? []).toEqual([]);
    });

    it.each([UserRole.SELLER, UserRole.BUYER])(
      '%s adiciona itens ao próprio carrinho',
      async (role) => {
        const user = role === UserRole.SELLER ? seller : buyer;
        const product = addProduct();

        const res = await addItem(
          { productId: product.id, quantity: 1 },
          user,
        ).expect(201);
        expect((res.body as CartBody).userId).toBe(user.id);
      },
    );

    it('adições simultâneas sem carrinho → um único carrinho ativo', async () => {
      const a = addProduct({ price: 10 });
      const b = addProduct({ price: 20 });

      const [resA, resB] = await Promise.all([
        addItem({ productId: a.id, quantity: 1 }),
        addItem({ productId: b.id, quantity: 1 }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(
        await carts.countBy({ userId: buyer.id, status: CartStatus.ACTIVE }),
      ).toBe(1);
      const body = (await getCart().expect(200)).body as CartBody;
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(30);
    });

    it('adições simultâneas do mesmo produto não perdem quantidade', async () => {
      const product = addProduct({ price: 10 });

      await Promise.all(
        [1, 2, 3].map((quantity) =>
          addItem({ productId: product.id, quantity }),
        ),
      );

      const body = (await getCart().expect(200)).body as CartBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ quantity: 6, subtotal: 60 });
      expect(body.total).toBe(60);
    });
  });

  describe('DELETE /cart/items/:itemId', () => {
    const setupTwoItems = async () => {
      const a = addProduct({ price: 20 });
      const b = addProduct({ price: 10.5 });
      await addItem({ productId: a.id, quantity: 1 }).expect(201);
      const res = await addItem({ productId: b.id, quantity: 2 }).expect(201);
      getProduct.mockClear();
      return res.body as CartBody;
    };

    it('remove o item e recalcula o total com o restante', async () => {
      const cart = await setupTwoItems();
      const [first, second] = cart.items;

      const res = await removeItem(first.id as string).expect(200);
      const body = res.body as CartBody;

      expect(body.items).toEqual([expect.objectContaining({ id: second.id })]);
      expect(body.total).toBe(21);
      expect(await cartItems.countBy({ id: first.id as string })).toBe(0);
      expect((await carts.findOneByOrFail({ id: cart.id! })).total).toBe(21);
      expect(getProduct).not.toHaveBeenCalled();
    });

    it('remover o último item mantém o carrinho ativo com total 0', async () => {
      const product = addProduct();
      const added = (
        await addItem({ productId: product.id, quantity: 1 }).expect(201)
      ).body as CartBody;

      const res = await removeItem(added.items[0].id as string).expect(200);
      const body = res.body as CartBody;

      expect(body).toMatchObject({
        id: added.id,
        items: [],
        total: 0,
        status: 'active',
      });
      const saved = await carts.findOneByOrFail({ id: added.id! });
      expect(saved.status).toBe(CartStatus.ACTIVE);
      expect(saved.total).toBe(0);
    });

    it('itemId não UUID → 400', async () => {
      const res = await removeItem('nao-e-uuid').expect(400);

      expect((res.body as { message: string }).message).toBe(
        'itemId deve ser um UUID válido',
      );
    });

    it('item inexistente → 404', async () => {
      await setupTwoItems();

      const res = await removeItem(randomUUID()).expect(404);
      expect(res.body).toStrictEqual({
        statusCode: 404,
        message: 'Item não encontrado no carrinho',
        error: 'Not Found',
      });
    });

    it('usuário sem carrinho ativo → 404', async () => {
      await removeItem(randomUUID()).expect(404);
    });

    it('item do carrinho de outro usuário → 404 e o carrinho dele não muda', async () => {
      const cart = await setupTwoItems();

      await removeItem(cart.items[0].id as string, seller).expect(404);

      const owner = (await getCart(buyer).expect(200)).body as CartBody;
      expect(owner.items).toHaveLength(2);
      expect(owner.total).toBe(cart.total);
    });

    it('item de carrinho completed do próprio usuário → 404', async () => {
      const completed = await carts.save(
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

      await removeItem(completed.items[0].id).expect(404);
      expect(await cartItems.countBy({ cartId: completed.id })).toBe(1);
    });
  });

  describe('posse e garantias do banco', () => {
    it('itens de um usuário não aparecem no carrinho de outro', async () => {
      const product = addProduct();
      await addItem({ productId: product.id, quantity: 1 }, buyer).expect(201);

      const res = await getCart(seller).expect(200);
      expect((res.body as CartBody).items).toEqual([]);
    });

    it('banco recusa um segundo carrinho active para o mesmo usuário, mas aceita completed', async () => {
      await carts.save(carts.create({ userId: buyer.id }));

      await expect(
        carts.save(carts.create({ userId: buyer.id })),
      ).rejects.toThrow();
      await expect(
        carts.save(
          carts.create({ userId: buyer.id, status: CartStatus.COMPLETED }),
        ),
      ).resolves.toBeDefined();
    });

    it('banco recusa dois itens do mesmo produto no mesmo carrinho', async () => {
      const cart = await carts.save(carts.create({ userId: buyer.id }));
      const item = {
        cartId: cart.id,
        productId: randomUUID(),
        productName: 'Cabo',
        price: 10,
        quantity: 1,
        subtotal: 10,
      };
      await cartItems.save(cartItems.create(item));

      await expect(cartItems.save(cartItems.create(item))).rejects.toThrow();
    });
  });
});
