import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '../src/auth/enums/user-role.enum';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { HealthController } from '../src/health/health.controller';

const JWT_SECRET = 'e2e-secret';
const HEALTH = { status: 'ok', service: 'checkout-service' };

// sem banco: o health é liveness e não depende do TypeORM
describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET })],
        }),
        PassportModule,
      ],
      controllers: [HealthController],
      // mesmo guard global da aplicação, para provar que a rota é pública
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem token → 200 com status e nome do serviço', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toStrictEqual(HEALTH);
  });

  it('com token malformado → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer nao-e-um-jwt')
      .expect(200);
    expect(res.body).toStrictEqual(HEALTH);
  });

  it('com token expirado → 200', async () => {
    const expired = new JwtService({ secret: JWT_SECRET }).sign({
      sub: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
      email: 'maria@example.com',
      role: UserRole.SELLER,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', `Bearer ${expired}`)
      .expect(200);
    expect(res.body).toStrictEqual(HEALTH);
  });
});
