import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { UserStatus } from '../src/users/enums/user-status.enum';

type CreatedUser = { id: string; email: string; token: string };
type UserBody = Record<string, unknown>;

const PUBLIC_FIELDS = [
  'createdAt',
  'email',
  'firstName',
  'id',
  'lastName',
  'role',
  'status',
  'updatedAt',
];
const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };
const NOT_FOUND = {
  statusCode: 404,
  message: 'Usuário não encontrado',
  error: 'Not Found',
};

// usa o AppModule completo: requer o Postgres do docker-compose no ar
describe('Consulta de usuários (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;

  const password = 'senha123';
  const uniqueEmail = (tag: string) =>
    `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  // registra e faz login; o token é obtido antes de qualquer mudança de status
  const createUser = async (
    tag: string,
    role: UserRole,
  ): Promise<CreatedUser> => {
    const email = uniqueEmail(tag);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, firstName: 'Maria', lastName: 'Silva', role })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const body = login.body as { user: { id: string }; token: string };
    return { id: body.user.id, email, token: body.token };
  };

  const deactivate = (user: CreatedUser) =>
    users.update(user.id, { status: UserStatus.INACTIVE });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
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
    users = app.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users/profile', () => {
    it('retorna os dados públicos do usuário logado, sem password', async () => {
      const user = await createUser('profile', UserRole.BUYER);

      const res = await get('/users/profile', user.token).expect(200);
      const body = res.body as UserBody;

      expect(Object.keys(body).sort()).toStrictEqual(PUBLIC_FIELDS);
      expect(body).toMatchObject({
        id: user.id,
        email: user.email,
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      });
    });

    it('retorna dados atualizados do banco, não do token', async () => {
      const user = await createUser('profile-fresh', UserRole.BUYER);
      await users.update(user.id, { firstName: 'Joana' });

      const res = await get('/users/profile', user.token).expect(200);

      expect(res.body).toMatchObject({ firstName: 'Joana' });
    });

    it('usuário removido após o login → 401', async () => {
      const user = await createUser('profile-removed', UserRole.BUYER);
      await users.delete(user.id);

      const res = await get('/users/profile', user.token).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });

    it('sem token → 401', async () => {
      const res = await get('/users/profile').expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });
  });

  describe('GET /users/sellers', () => {
    let activeSeller: CreatedUser;
    let inactiveSeller: CreatedUser;
    let activeBuyer: CreatedUser;
    let inactiveBuyer: CreatedUser;

    beforeAll(async () => {
      activeSeller = await createUser('seller-active', UserRole.SELLER);
      inactiveSeller = await createUser('seller-inactive', UserRole.SELLER);
      activeBuyer = await createUser('buyer-active', UserRole.BUYER);
      inactiveBuyer = await createUser('buyer-inactive', UserRole.BUYER);
      await deactivate(inactiveSeller);
      await deactivate(inactiveBuyer);
    });

    it('retorna somente sellers ativos, sem password', async () => {
      const res = await get('/users/sellers', activeBuyer.token).expect(200);
      const body = res.body as UserBody[];
      const ids = body.map((seller) => seller.id);

      expect(ids).toContain(activeSeller.id);
      expect(ids).not.toContain(inactiveSeller.id);
      expect(ids).not.toContain(activeBuyer.id);
      expect(ids).not.toContain(inactiveBuyer.id);
      for (const seller of body) {
        expect(seller).toMatchObject({
          role: UserRole.SELLER,
          status: UserStatus.ACTIVE,
        });
        expect(seller).not.toHaveProperty('password');
      }
    });

    it('acessível por buyer e por seller', async () => {
      await get('/users/sellers', activeBuyer.token).expect(200);
      await get('/users/sellers', activeSeller.token).expect(200);
    });

    it('sem token → 401', async () => {
      const res = await get('/users/sellers').expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });
  });

  describe('GET /users/:id', () => {
    let requester: CreatedUser;

    beforeAll(async () => {
      requester = await createUser('requester', UserRole.BUYER);
    });

    it('retorna o usuário pelo id, sem password', async () => {
      const target = await createUser('target', UserRole.SELLER);

      const res = await get(`/users/${target.id}`, requester.token).expect(200);
      const body = res.body as UserBody;

      expect(Object.keys(body).sort()).toStrictEqual(PUBLIC_FIELDS);
      expect(body).toMatchObject({ id: target.id, email: target.email });
    });

    it('retorna buyer inativo', async () => {
      const target = await createUser('target-inactive', UserRole.BUYER);
      await deactivate(target);

      const res = await get(`/users/${target.id}`, requester.token).expect(200);

      expect(res.body).toMatchObject({
        id: target.id,
        role: UserRole.BUYER,
        status: UserStatus.INACTIVE,
      });
    });

    it('UUID sem usuário correspondente → 404', async () => {
      const res = await get(
        '/users/00000000-0000-4000-8000-000000000000',
        requester.token,
      ).expect(404);
      expect(res.body).toStrictEqual(NOT_FOUND);
    });

    it.each(['abc', '123'])(
      'id fora do formato UUID (%s) → 404',
      async (id) => {
        const res = await get(`/users/${id}`, requester.token).expect(404);
        expect(res.body).toStrictEqual(NOT_FOUND);
      },
    );

    it('sem token → 401', async () => {
      const res = await get(`/users/${requester.id}`).expect(401);
      expect(res.body).toStrictEqual(UNAUTHORIZED);
    });
  });

  describe('ordem das rotas', () => {
    it('/users/profile e /users/sellers não são tratados como :id', async () => {
      const user = await createUser('routes', UserRole.BUYER);

      const profile = await get('/users/profile', user.token).expect(200);
      expect(profile.body).toMatchObject({ id: user.id });

      const sellers = await get('/users/sellers', user.token).expect(200);
      expect(Array.isArray(sellers.body)).toBe(true);
    });
  });
});
