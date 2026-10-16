import { HttpService } from '@nestjs/axios';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { serviceConfig } from '../../config/gateway.config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  const httpService = { get: jest.fn() };

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

  describe('validateSessionToken', () => {
    it('consulta /session/validate do users-service e devolve a sessão', async () => {
      const session = { valid: true, user: { id: '1' } };
      httpService.get.mockReturnValue(of({ data: session }));

      await expect(service.validateSessionToken('abc')).resolves.toEqual(
        session,
      );
      expect(httpService.get).toHaveBeenCalledWith(
        `${serviceConfig.users.url}/session/validate/abc`,
        expect.objectContaining({ timeout: serviceConfig.users.timeout }),
      );
    });

    it('qualquer erro vira 401', async () => {
      httpService.get.mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.validateSessionToken('abc')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
