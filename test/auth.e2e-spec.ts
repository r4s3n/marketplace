import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/users/enums/user-role.enum';

// usa o AppModule completo: requer o Postgres do docker-compose no ar
describe('Auth com guard global (e2e)', () => {
  let app: INestApplication<App>;

  const password = 'senha123';
  const newUser = (email: string) => ({
    email,
    password,
    firstName: 'Maria',
    lastName: 'Silva',
    role: UserRole.BUYER,
  });
  const uniqueEmail = (tag: string) =>
    `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register sem token cria o usuário', async () => {
    const email = uniqueEmail('register');

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(newUser(email))
      .expect(201);

    expect(res.body).toMatchObject({ email, role: UserRole.BUYER });
    expect(res.body).not.toHaveProperty('password');
  });

  it('POST /auth/login sem token retorna o token', async () => {
    const email = uniqueEmail('login');
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(newUser(email))
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body).toMatchObject({ user: { email } });
    expect(typeof (res.body as { token: unknown }).token).toBe('string');
  });

  it('register e login funcionam mesmo com token inválido no header', async () => {
    const email = uniqueEmail('invalid-token');

    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Authorization', 'Bearer token-invalido')
      .send(newUser(email))
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Authorization', 'Bearer token-invalido')
      .send({ email, password })
      .expect(200);
  });

  it('GET / (rota não pública) sem token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(401);

    expect(res.body).toStrictEqual({
      statusCode: 401,
      message: 'Unauthorized',
    });
  });

  it('GET / com token obtido no login → acesso concedido', async () => {
    const email = uniqueEmail('access');
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(newUser(email))
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const { token } = login.body as { token: string };

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect('Hello World!');
  });
});
