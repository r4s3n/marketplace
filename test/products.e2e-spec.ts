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
const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };
const FORBIDDEN = {
  statusCode: 403,
  message: 'Apenas vendedores podem criar produtos',
  error: 'Forbidden',
};

// usa o AppModule completo: requer o Postgres do docker-compose no ar
describe('Criação de produto (e2e)', () => {
  let app: INestApplication<App>;
  let products: Repository<Product>;
  let sellerToken: string;
  let buyerToken: string;
  let expiredToken: string;

  // ids novos a cada execução para isolar a contagem e a limpeza
  const sellerId = randomUUID();
  const buyerId = randomUUID();

  const validBody = {
    name: 'Teclado mecânico',
    description: 'Teclado mecânico ABNT2 com switches marrons',
    price: 349.9,
    stock: 15,
  };

  const post = (body: object, token?: string) => {
    const req = request(app.getHttpServer()).post('/products').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const countBy = (id: string) => products.count({ where: { sellerId: id } });

  const messagesOf = (body: unknown) => (body as { message: string[] }).message;

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

    // o .env já foi carregado pelo ConfigModule do AppModule
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const payload = (sub: string, role: UserRole): JwtPayload => ({
      sub,
      email: `${role}@example.com`,
      role,
    });
    sellerToken = jwt.sign(payload(sellerId, UserRole.SELLER), {
      expiresIn: 3600,
    });
    buyerToken = jwt.sign(payload(buyerId, UserRole.BUYER), {
      expiresIn: 3600,
    });
    expiredToken = jwt.sign({
      ...payload(sellerId, UserRole.SELLER),
      exp: Math.floor(Date.now() / 1000) - 60,
    });
  });

  afterAll(async () => {
    await products.delete({ sellerId: In([sellerId, buyerId]) });
    await app.close();
  });

  describe('sucesso', () => {
    it('seller cria o produto → 201 com os 9 campos', async () => {
      const res = await post(validBody, sellerToken).expect(201);
      const body = res.body as ProductBody;

      expect(Object.keys(body).sort()).toStrictEqual(PRODUCT_FIELDS);
      expect(body).toMatchObject({
        ...validBody,
        sellerId,
        isActive: true,
      });
      expect(typeof body.price).toBe('number');

      const stored = await products.findOneBy({ id: body.id as string });
      expect(stored).toMatchObject({
        name: validBody.name,
        sellerId,
        isActive: true,
        stock: validBody.stock,
      });
      expect(Number(stored?.price)).toBe(validBody.price);
    });

    it('aceita os limites: price 0.01, stock 0 e name com 255 caracteres', async () => {
      const res = await post(
        { ...validBody, name: 'a'.repeat(255), price: 0.01, stock: 0 },
        sellerToken,
      ).expect(201);

      expect(res.body).toMatchObject({ price: 0.01, stock: 0 });
    });
  });

  describe('autenticação e autorização', () => {
    it('sem token → 401 e nada é gravado', async () => {
      const before = await countBy(sellerId);

      const res = await post(validBody).expect(401);

      expect(res.body).toStrictEqual(UNAUTHORIZED);
      expect(await countBy(sellerId)).toBe(before);
    });

    it.each([
      ['inválido', () => 'nao-e-um-jwt'],
      ['expirado', () => expiredToken],
    ])('token %s → 401 e nada é gravado', async (_, token) => {
      const before = await countBy(sellerId);

      const res = await post(validBody, token()).expect(401);

      expect(res.body).toStrictEqual(UNAUTHORIZED);
      expect(await countBy(sellerId)).toBe(before);
    });

    it('buyer com corpo válido → 403 e nada é gravado', async () => {
      const res = await post(validBody, buyerToken).expect(403);

      expect(res.body).toStrictEqual(FORBIDDEN);
      expect(await countBy(buyerId)).toBe(0);
    });

    it('buyer com corpo inválido → 400 (validação antes do role)', async () => {
      await post({}, buyerToken).expect(400);
      expect(await countBy(buyerId)).toBe(0);
    });
  });

  describe('validação', () => {
    it('corpo vazio → 400 com mensagens dos 4 campos', async () => {
      const res = await post({}, sellerToken).expect(400);
      const messages = messagesOf(res.body);

      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      for (const field of ['name', 'description', 'price', 'stock']) {
        expect(messages).toContain(`${field} é obrigatório`);
      }
    });

    it.each([
      ['name vazio', { name: '' }, 'name é obrigatório'],
      [
        'name com 256 caracteres',
        { name: 'a'.repeat(256) },
        'name deve ter no máximo 255 caracteres',
      ],
      ['description vazio', { description: '' }, 'description é obrigatório'],
      [
        'description numérico',
        { description: 123 },
        'description deve ser um texto',
      ],
      ['price 0', { price: 0 }, 'price deve ser no mínimo 0.01'],
      ['price negativo', { price: -10 }, 'price deve ser no mínimo 0.01'],
      [
        'price com 3 casas decimais',
        { price: 10.555 },
        'price deve ser um número com no máximo 2 casas decimais',
      ],
      [
        'price acima do limite',
        { price: 100000000 },
        'price deve ser no máximo 99999999.99',
      ],
      [
        'price como texto',
        { price: '10.50' },
        'price deve ser um número com no máximo 2 casas decimais',
      ],
      ['stock negativo', { stock: -1 }, 'stock deve ser no mínimo 0'],
      ['stock decimal', { stock: 2.5 }, 'stock deve ser um número inteiro'],
      [
        'stock acima do limite',
        { stock: 2147483648 },
        'stock deve ser no máximo 2147483647',
      ],
      ['stock como texto', { stock: '5' }, 'stock deve ser um número inteiro'],
    ])('%s → 400', async (_, override, message) => {
      const res = await post({ ...validBody, ...override }, sellerToken).expect(
        400,
      );

      expect(messagesOf(res.body)).toContain(message);
    });

    it('sellerId no corpo → 400 e nada é gravado com esse sellerId', async () => {
      const otherSeller = randomUUID();

      await post({ ...validBody, sellerId: otherSeller }, sellerToken).expect(
        400,
      );

      expect(await countBy(otherSeller)).toBe(0);
    });

    it.each([
      ['isActive', { isActive: false }],
      ['id', { id: randomUUID() }],
      ['campo desconhecido', { categoria: 'periféricos' }],
    ])('%s no corpo → 400 e nada é gravado', async (_, extra) => {
      const before = await countBy(sellerId);

      await post({ ...validBody, ...extra }, sellerToken).expect(400);

      expect(await countBy(sellerId)).toBe(before);
    });

    it('vários erros ao mesmo tempo → todos na lista', async () => {
      const res = await post(
        { name: '', description: 'ok', price: 0, stock: 2.5 },
        sellerToken,
      ).expect(400);

      expect(messagesOf(res.body)).toEqual(
        expect.arrayContaining([
          'name é obrigatório',
          'price deve ser no mínimo 0.01',
          'stock deve ser um número inteiro',
        ]),
      );
    });
  });
});
