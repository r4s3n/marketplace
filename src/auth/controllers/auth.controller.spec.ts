import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../service/auth.service';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { login: jest.fn(), register: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('login delega ao AuthService e devolve a resposta do users-service', async () => {
    const body = { user: { id: '1' }, token: 'jwt' };
    authService.login.mockResolvedValue(body);
    const dto = { email: 'maria@example.com', password: 'senha123' };

    await expect(controller.login(dto)).resolves.toEqual(body);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('register delega ao AuthService e devolve o usuário criado', async () => {
    const body = { id: '1', email: 'maria@example.com' };
    authService.register.mockResolvedValue(body);
    const dto = {
      email: 'maria@example.com',
      password: 'senha123',
      firstName: 'Maria',
      lastName: 'Silva',
    };

    await expect(controller.register(dto)).resolves.toEqual(body);
    expect(authService.register).toHaveBeenCalledWith(dto);
  });
});
