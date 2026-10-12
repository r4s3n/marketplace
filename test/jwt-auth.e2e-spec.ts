import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Public } from '../src/auth/decorators/public.decorator';
import { UserRole } from '../src/auth/enums/user-role.enum';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';
import { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';

const JWT_SECRET = 'e2e-secret';
const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

// controllers de teste: nenhum declara guard, a proteção vem do APP_GUARD
@Controller('protected')
class ProtectedController {
  @Get()
  me(@Req() req: Request & { user: AuthenticatedUser }): AuthenticatedUser {
    return req.user;
  }
}

@Controller('mixed')
class MixedController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('closed')
  closed() {
    return { ok: true };
  }
}

@Public()
@Controller('public')
class PublicController {
  @Get('a')
  a() {
    return { ok: true };
  }

  @Get('b')
  b() {
    return { ok: true };
  }
}

describe('Proteção de rotas com JWT (e2e)', () => {
  let app: INestApplication<App>;

  // mesmo formato de payload emitido pelo users-service no login
  const payload: JwtPayload = {
    sub: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'maria@example.com',
    role: UserRole.BUYER,
  };
  const jwt = new JwtService({ secret: JWT_SECRET });
  const validToken = jwt.sign(payload, { expiresIn: 3600 });
  const expiredToken = jwt.sign({
    ...payload,
    exp: Math.floor(Date.now() / 1000) - 60,
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET })],
        }),
        PassportModule,
      ],
      controllers: [ProtectedController, MixedController, PublicController],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const getProtected = (authorization?: string) => {
    const req = request(app.getHttpServer()).get('/protected');
    return authorization ? req.set('Authorization', authorization) : req;
  };

  describe('rota protegida', () => {
    it('sem header Authorization → 401', async () => {
      const res = await getProtected().expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('header sem prefixo Bearer → 401', async () => {
      const res = await getProtected(validToken).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('Bearer sem token → 401', async () => {
      const res = await getProtected('Bearer ').expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token malformado → 401', async () => {
      const res = await getProtected('Bearer nao-e-um-jwt').expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token assinado com outro secret → 401', async () => {
      const token = new JwtService({ secret: 'outro-secret' }).sign(payload);

      const res = await getProtected(`Bearer ${token}`).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token com payload adulterado → 401', async () => {
      const [header, , signature] = validToken.split('.');
      const forged = Buffer.from(
        JSON.stringify({ ...payload, role: UserRole.SELLER }),
      ).toString('base64url');

      const res = await getProtected(
        `Bearer ${header}.${forged}.${signature}`,
      ).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token expirado → 401', async () => {
      const res = await getProtected(`Bearer ${expiredToken}`).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('token válido → acesso com req.user contendo só id, email e role', async () => {
      const res = await getProtected(`Bearer ${validToken}`).expect(200);

      expect(res.body).toStrictEqual({
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      });
    });

    it.each([UserRole.SELLER, UserRole.BUYER])(
      'token válido de %s → acesso concedido',
      async (role) => {
        const token = jwt.sign({ ...payload, role }, { expiresIn: 3600 });

        const res = await getProtected(`Bearer ${token}`).expect(200);
        expect(res.body).toStrictEqual({
          id: payload.sub,
          email: payload.email,
          role,
        });
      },
    );

    it('campos extras do payload não chegam em req.user', async () => {
      const token = jwt.sign(
        { ...payload, name: 'Maria' },
        { expiresIn: 3600 },
      );

      const res = await getProtected(`Bearer ${token}`).expect(200);
      expect(res.body).toStrictEqual({
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      });
    });
  });

  describe('@Public()', () => {
    it('em um método libera apenas aquela rota', async () => {
      await request(app.getHttpServer()).get('/mixed/open').expect(200);
      await request(app.getHttpServer()).get('/mixed/closed').expect(401);
    });

    it('em um controller libera todas as rotas da classe', async () => {
      await request(app.getHttpServer()).get('/public/a').expect(200);
      await request(app.getHttpServer()).get('/public/b').expect(200);
    });

    it('rota pública ignora token inválido no header', async () => {
      await request(app.getHttpServer())
        .get('/public/a')
        .set('Authorization', 'Bearer nao-e-um-jwt')
        .expect(200);
    });

    it('rota pública ignora token expirado no header', async () => {
      await request(app.getHttpServer())
        .get('/public/a')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(200);
    });
  });
});
