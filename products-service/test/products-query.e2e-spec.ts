import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/auth/enums/user-role.enum';
import { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { Product } from '../src/products/entities/product.entity';

type ProductBody = Record<string, unknown>;

const PRODUCT_FIELDS = [
  'createdAt',
  'description',
  'id',
  'isActive',
  'name',
  'price',
  'sellerId',
  'stock',
  'updatedAt',
];
const NOT_FOUND = {
  statusCode: 404,
  message: 'Produto não encontrado',
  error: 'Not Found',
};
const badUuid = (param: string) => ({
  statusCode: 400,
  message: `${param} deve ser um UUID válido`,
  error: 'Bad Request',
});

// usa o AppModule completo: requer o Postgres do docker-compose no ar
describe('Consulta de produtos (e2e)', () => {
  let app: INestApplication<App>;
  let products: Repository<Product>;
  const tokens: Record<string, string> = {};

  // ids novos a cada execução: o banco é compartilhado com outros produtos
  const sellerA = randomUUID();
  const sellerB = randomUUID();

  // createdAt espaçados para a ordenação não depender do relógio
  const base = Date.now() - 60 * 60 * 1000;
  const at = (minutes: number) => new Date(base + minutes * 60 * 1000);

  let a1: Product;
  let a2: Product;
  let aInactive: Product;
  let b1: Product;

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const bodyOf = (res: { body: unknown }) => res.body as ProductBody;
  const listOf = (res: { body: unknown }) => res.body as ProductBody[];
  const idsOf = (list: ProductBody[], sellers: string[]) =>
    list.filter((p) => sellers.includes(p.sellerId as string)).map((p) => p.id);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    products = app.get<Repository<Product>>(getRepositoryToken(Product));

    // não há endpoint para desativar: o seed grava direto no repositório
    const seed = (
      sellerId: string,
      name: string,
      minutes: number,
      isActive = true,
    ) =>
      products.save(
        products.create({
          name,
          description: `${name} para teste de consulta`,
          price: 349.9,
          stock: 15,
          sellerId,
          isActive,
          createdAt: at(minutes),
        }),
      );
    a1 = await seed(sellerA, 'Produto A1', 0);
    a2 = await seed(sellerA, 'Produto A2', 1);
    aInactive = await seed(sellerA, 'Produto A inativo', 2, false);
    b1 = await seed(sellerB, 'Produto B1', 3);

    // o .env já foi carregado pelo ConfigModule do AppModule
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const payload = (sub: string, role: UserRole): JwtPayload => ({
      sub,
      email: `${role}@example.com`,
      role,
    });
    tokens.seller = jwt.sign(payload(sellerA, UserRole.SELLER), {
      expiresIn: 3600,
    });
    tokens.buyer = jwt.sign(payload(randomUUID(), UserRole.BUYER), {
      expiresIn: 3600,
    });
    tokens.inválido = 'nao-e-um-jwt';
    tokens.expirado = jwt.sign({
      ...payload(sellerA, UserRole.SELLER),
      exp: Math.floor(Date.now() / 1000) - 60,
    });
  });

  afterAll(async () => {
    await products.delete({ sellerId: In([sellerA, sellerB]) });
    await app.close();
  });

  describe('GET /products', () => {
    it('sem token → 200 só com os ativos, mais recentes primeiro', async () => {
      const res = await get('/products').expect(200);

      expect(idsOf(listOf(res), [sellerA, sellerB])).toStrictEqual([
        b1.id,
        a2.id,
        a1.id,
      ]);
    });

    it('não lista produtos inativos', async () => {
      const res = await get('/products').expect(200);

      expect(listOf(res).every((p) => p.isActive === true)).toBe(true);
      expect(listOf(res).map((p) => p.id)).not.toContain(aInactive.id);
    });

    it('cada item tem os 9 campos, com price numérico', async () => {
      const res = await get('/products').expect(200);
      const item = listOf(res).find((p) => p.id === a1.id);

      expect(Object.keys(item ?? {}).sort()).toStrictEqual(PRODUCT_FIELDS);
      expect(item?.price).toBe(349.9);
    });
  });

  describe('GET /products/seller/:sellerId', () => {
    it('sem token → 200 só com os ativos do vendedor, mais recentes primeiro', async () => {
      const res = await get(`/products/seller/${sellerA}`).expect(200);

      // array prova que a rota não caiu em :id
      expect(Array.isArray(res.body)).toBe(true);
      expect(listOf(res).map((p) => p.id)).toStrictEqual([a2.id, a1.id]);
      expect(typeof listOf(res)[0].price).toBe('number');
    });

    it('vendedor sem produtos → 200 com []', async () => {
      const res = await get(`/products/seller/${randomUUID()}`).expect(200);

      expect(res.body).toStrictEqual([]);
    });

    it('sellerId que não é UUID → 400', async () => {
      const res = await get('/products/seller/abc').expect(400);

      expect(res.body).toStrictEqual(badUuid('sellerId'));
    });
  });

  describe('GET /products/:id', () => {
    it('sem token → 200 com os dados do banco', async () => {
      const res = await get(`/products/${a1.id}`).expect(200);
      const stored = await products.findOneBy({ id: a1.id });

      expect(Object.keys(bodyOf(res)).sort()).toStrictEqual(PRODUCT_FIELDS);
      expect(res.body).toStrictEqual(JSON.parse(JSON.stringify(stored)));
      expect(bodyOf(res).price).toBe(349.9);
    });

    it('produto inativo → 200 com isActive false', async () => {
      const res = await get(`/products/${aInactive.id}`).expect(200);

      expect(res.body).toMatchObject({ id: aInactive.id, isActive: false });
    });

    it('produto inexistente → 404', async () => {
      const res = await get(`/products/${randomUUID()}`).expect(404);

      expect(res.body).toStrictEqual(NOT_FOUND);
    });

    it.each(['abc', '123', 'seller'])('id "%s" → 400', async (id) => {
      const res = await get(`/products/${id}`).expect(400);

      expect(res.body).toStrictEqual(badUuid('id'));
    });
  });

  describe('rotas públicas', () => {
    it.each(['seller', 'buyer', 'inválido', 'expirado'])(
      'token %s não muda a resposta das consultas',
      async (kind) => {
        const token = tokens[kind];

        await get('/products', token).expect(200);
        await get(`/products/seller/${sellerA}`, token).expect(200);
        await get(`/products/${a1.id}`, token).expect(200);
      },
    );

    it('POST /products continua exigindo token', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .send({ name: 'x', description: 'x', price: 1, stock: 1 })
        .expect(401);
    });
  });
});
