import { HttpService } from '@nestjs/axios';
import {
  GatewayTimeoutException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { serviceConfig } from '../../config/gateway.config';
import { AuthService } from './auth.service';

// monta um erro do axios com (ou sem) resposta do users-service
const axiosError = (status?: number, data?: unknown, code?: string) => {
  const response = status
    ? ({
        status,
        data,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
      } as AxiosResponse)
    : undefined;
  return new AxiosError('request failed', code, undefined, undefined, response);
};

describe('AuthService', () => {
  let service: AuthService;
  const httpService = { post: jest.fn(), get: jest.fn() };

  const loginDto = { email: 'maria@example.com', password: 'senha123' };
  const registerDto = {
    ...loginDto,
    firstName: 'Maria',
    lastName: 'Silva',
    role: 'seller',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: HttpService, useValue: httpService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const expectHttpError = async (
    promise: Promise<unknown>,
    status: number,
    body?: unknown,
  ) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    if (body) expect((error as HttpException).getResponse()).toEqual(body);
  };

  describe('login', () => {
    it('chama POST /auth/login do users-service e devolve o corpo sem alteração', async () => {
      const body = { user: { id: '1' }, token: 'jwt' };
      httpService.post.mockReturnValue(of({ data: body }));

      await expect(service.login(loginDto)).resolves.toEqual(body);
      expect(httpService.post).toHaveBeenCalledWith(
        `${serviceConfig.users.url}/auth/login`,
        loginDto,
        expect.objectContaining({ timeout: serviceConfig.users.timeout }),
      );
    });

    it('preserva o 401 de credenciais inválidas', async () => {
      const body = { statusCode: 401, message: 'Credenciais inválidas' };
      httpService.post.mockReturnValue(throwError(() => axiosError(401, body)));

      await expectHttpError(service.login(loginDto), 401, body);
    });

    it('preserva o 400 de dados inválidos', async () => {
      httpService.post.mockReturnValue(
        throwError(() => axiosError(400, { statusCode: 400 })),
      );

      await expectHttpError(service.login(loginDto), 400);
    });

    it('users-service fora do ar → 503', async () => {
      httpService.post.mockReturnValue(
        throwError(() => axiosError(undefined, undefined, 'ECONNREFUSED')),
      );

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('timeout → 504', async () => {
      httpService.post.mockReturnValue(
        throwError(() => axiosError(undefined, undefined, 'ECONNABORTED')),
      );

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        GatewayTimeoutException,
      );
    });
  });

  describe('register', () => {
    it('chama POST /auth/register do users-service e devolve o corpo', async () => {
      const body = { id: '1', email: loginDto.email };
      httpService.post.mockReturnValue(of({ data: body }));

      await expect(service.register(registerDto)).resolves.toEqual(body);
      expect(httpService.post).toHaveBeenCalledWith(
        `${serviceConfig.users.url}/auth/register`,
        registerDto,
        expect.objectContaining({ timeout: serviceConfig.users.timeout }),
      );
    });

    it('preserva o 409 de e-mail já cadastrado', async () => {
      const body = { statusCode: 409, message: 'E-mail já cadastrado' };
      httpService.post.mockReturnValue(throwError(() => axiosError(409, body)));

      await expectHttpError(service.register(registerDto), 409, body);
    });

    it('erro desconhecido → 503 sem expor detalhes', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error('boom at http://localhost:3000')),
      );

      const error = await service
        .register(registerDto)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(
        JSON.stringify((error as HttpException).getResponse()),
      ).not.toContain('localhost');
    });
  });
});
