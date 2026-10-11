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

  const expectForwarded = (path: string) =>
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'get',
      path,
      undefined,
      { authorization },
      user,
    );

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

  it('GET /users/:id encaminha com o id codificado', async () => {
    proxyService.proxyRequest.mockResolvedValue({ id: 'abc' });

    await controller.findById('a/b', authorization, user);
    expectForwarded('/users/a%2Fb');
  });

  it('protege o controller com o JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      UsersController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});
