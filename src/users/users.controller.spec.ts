import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  let controller: UsersController;
  const proxyService = { proxyRequest: jest.fn() };

  const authorization = 'Bearer jwt-token';
  const user = {
    userId: 'user-id',
    email: 'maria@example.com',
    role: 'seller',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  const guardsOf = (target: object) =>
    (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

  // metadados de guard e de status ficam na função do handler
  const handler = (name: keyof UsersController) =>
    Object.getOwnPropertyDescriptor(UsersController.prototype, name)
      ?.value as object;

  const expectForwarded = (path: string) =>
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'get',
      path,
      undefined,
      { authorization },
      user,
    );

  describe('rotas públicas', () => {
    it('POST /auth/register encaminha o corpo intacto, sem Authorization nem usuário', async () => {
      // sem role e com campo extra: prova que o gateway não valida nem completa o corpo
      const body = { email: user.email, password: 'senha123', extra: 'x' };
      const created = { id: 'user-id', email: user.email };
      proxyService.proxyRequest.mockResolvedValue(created);

      await expect(controller.register(body)).resolves.toEqual(created);
      expect(proxyService.proxyRequest).toHaveBeenCalledWith(
        'users',
        'post',
        '/auth/register',
        body,
      );
      expect(proxyService.proxyRequest.mock.calls[0]).toHaveLength(4);
      expect(proxyService.proxyRequest.mock.calls[0][3]).toBe(body);
    });

    it('POST /auth/login encaminha o corpo intacto e devolve { user, token }', async () => {
      const body = { email: user.email, password: 'senha123' };
      const response = { user: { id: 'user-id' }, token: 'jwt' };
      proxyService.proxyRequest.mockResolvedValue(response);

      await expect(controller.login(body)).resolves.toEqual(response);
      expect(proxyService.proxyRequest).toHaveBeenCalledWith(
        'users',
        'post',
        '/auth/login',
        body,
      );
      expect(proxyService.proxyRequest.mock.calls[0]).toHaveLength(4);
      expect(proxyService.proxyRequest.mock.calls[0][3]).toBe(body);
    });

    it('POST /auth/login responde 200', () => {
      expect(Reflect.getMetadata('__httpCode__', handler('login'))).toBe(200);
    });

    it('propaga sem conversão o erro 4xx repassado pelo ProxyService', async () => {
      const error = new ConflictException('E-mail já cadastrado');
      proxyService.proxyRequest.mockRejectedValue(error);

      await expect(controller.register({})).rejects.toBe(error);
    });
  });

  describe('rotas protegidas', () => {
    it('GET /auth/validate-token encaminha com Authorization e usuário', async () => {
      const body = { userId: 'user-id', email: user.email, role: 'seller' };
      proxyService.proxyRequest.mockResolvedValue(body);

      await expect(
        controller.validateToken(authorization, user),
      ).resolves.toEqual(body);
      expectForwarded('/auth/validate-token');
    });

    it('GET /users/profile encaminha ao users-service e devolve o corpo', async () => {
      const body = { id: 'user-id', email: user.email };
      proxyService.proxyRequest.mockResolvedValue(body);

      await expect(controller.profile(authorization, user)).resolves.toEqual(
        body,
      );
      expectForwarded('/users/profile');
    });

    it('GET /users/sellers encaminha ao users-service e devolve o array', async () => {
      const body = [{ id: 'seller-id' }];
      proxyService.proxyRequest.mockResolvedValue(body);

      await expect(controller.sellers(authorization, user)).resolves.toEqual(
        body,
      );
      expectForwarded('/users/sellers');
    });

    it('GET /users/:id codifica o id como um único segmento', async () => {
      proxyService.proxyRequest.mockResolvedValue({ id: 'abc' });

      await controller.findById('a/b?c', authorization, user);
      expectForwarded('/users/a%2Fb%3Fc');
    });

    it.each(['.', '..'])(
      'barra o id %p sem chamar o users-service',
      (value) => {
        expect(() => controller.findById(value, authorization, user)).toThrow(
          BadRequestException,
        );
        expect(proxyService.proxyRequest).not.toHaveBeenCalled();
      },
    );
  });

  it('aplica o JwtAuthGuard só nas rotas protegidas', () => {
    expect(guardsOf(UsersController)).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('register'))).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('login'))).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('validateToken'))).toContain(JwtAuthGuard);
    expect(guardsOf(handler('profile'))).toContain(JwtAuthGuard);
    expect(guardsOf(handler('sellers'))).toContain(JwtAuthGuard);
    expect(guardsOf(handler('findById'))).toContain(JwtAuthGuard);
  });
});
