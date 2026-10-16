import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/users/enums/user-role.enum';

type LoggedUser = { id: string; email: string; token: string };

const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

// usa o AppModule completo: requer o Postgres do docker-compose no ar
describe('Integração com o api-gateway (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let user: LoggedUser;

  const password = 'senha123';

  const get = (path: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return authorization ? req.set('Authorization', authorization) : req;
  };

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
    // instância sem expiresIn padrão, com o mesmo secret, para forjar tokens expirados
    jwt = new JwtService({ secret: process.env.JWT_SECRET });

    const email = `e2e-gateway-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        firstName: 'Maria',
        lastName: 'Silva',
        role: UserRole.SELLER,
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const body = login.body as { user: { id: string }; token: string };
    user = { id: body.user.id, email, token: body.token };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('sem token → 200 com status e nome do serviço', async () => {
      const res = await get('/health').expect(200);
      expect(res.body).toStrictEqual({
        status: 'ok',
        service: 'users-service',
      });
    });

    it('com token inválido → continua 200', async () => {
      await get('/health', 'Bearer token-invalido').expect(200);
    });
  });

  describe('GET /auth/validate-token', () => {
    it('token válido → 200 com exatamente userId, email e role', async () => {
      const res = await get(
        '/auth/validate-token',
        `Bearer ${user.token}`,
      ).expect(200);

      expect(res.body).toStrictEqual({
        userId: user.id,
        email: user.email,
        role: UserRole.SELLER,
      });
    });

    it('sem token → 401', async () => {
      const res = await get('/auth/validate-token').expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token malformado → 401', async () => {
      await get('/auth/validate-token', 'Bearer nao-e-um-jwt').expect(401);
    });

    it('token expirado → 401', async () => {
      const exp = Math.floor(Date.now() / 1000) - 60;
      const expired = jwt.sign({
        sub: user.id,
        email: user.email,
        role: UserRole.SELLER,
        exp,
      });
      await get('/auth/validate-token', `Bearer ${expired}`).expect(401);
    });
  });
});
