import { HttpService } from '@nestjs/axios';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { CircuitBreakerService } from '../../common/circuit-breaker/circuit-breaker.service';
import { CacheFallbackService } from '../../common/fallback/cache.fallback';
import { defaultFallbackService } from '../../common/fallback/default.fallback';
import { RetryService } from '../../common/retry/retry.service';
import { TimeoutService } from '../../common/timeout/timeout.service';
import { serviceConfig } from '../../config/gateway.config';
import { ProxyService } from './proxy.service';

// erro do axios com (ou sem) resposta do serviço
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

const ok = (data: unknown) => of({ data } as AxiosResponse);
const fail = (error: Error) => throwError(() => error);

describe('ProxyService', () => {
  let service: ProxyService;
  let circuitBreaker: CircuitBreakerService;
  const httpService = { request: jest.fn() };

  const user = {
    userId: 'user-id',
    email: 'maria@example.com',
    role: 'seller',
  };
  const headers = { authorization: 'Bearer jwt' };
  const MAX_ATTEMPTS = 5; // 1 tentativa + 4 retries

  const callProfile = () =>
    service.proxyRequest(
      'users',
      'get',
      '/users/profile',
      undefined,
      headers,
      user,
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    // sem esperar o backoff entre as tentativas
    jest
      .spyOn(
        RetryService.prototype as unknown as { delay: () => Promise<void> },
        'delay',
      )
      .mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyService,
        CircuitBreakerService,
        CacheFallbackService,
        defaultFallbackService,
        RetryService,
        TimeoutService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(ProxyService);
    circuitBreaker = module.get(CircuitBreakerService);
  });

  afterEach(() => jest.restoreAllMocks());

  const failures = () =>
    circuitBreaker.getCircuitState('proxy-users')?.failureCount ?? 0;

  describe('sucesso', () => {
    it('encaminha para a URL do serviço e devolve apenas o corpo', async () => {
      httpService.request.mockReturnValue(ok({ id: 'user-id' }));

      await expect(callProfile()).resolves.toEqual({ id: 'user-id' });
      expect(httpService.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'get',
          url: `${serviceConfig.users.url}/users/profile`,
          timeout: serviceConfig.users.timeout,
        }),
      );
    });

    it('repassa o Authorization e os dados do usuário em headers x-user-*', async () => {
      httpService.request.mockReturnValue(ok({}));

      await callProfile();
      expect(httpService.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            authorization: 'Bearer jwt',
            'x-user-id': 'user-id',
            'x-user-email': 'maria@example.com',
            'x-user-role': 'seller',
          },
        }),
      );
    });
  });

  describe('erros 4xx do serviço', () => {
    it.each([
      [404, { statusCode: 404, message: 'Usuário não encontrado' }],
      [401, { statusCode: 401, message: 'Unauthorized' }],
      [400, { statusCode: 400, message: ['id inválido'] }],
    ])('%i é repassado com o mesmo status e corpo', async (status, body) => {
      httpService.request.mockReturnValue(fail(axiosError(status, body)));

      const error = await callProfile().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(status);
      expect((error as HttpException).getResponse()).toEqual(body);
    });

    it('não sofre retry', async () => {
      httpService.request.mockReturnValue(fail(axiosError(404, {})));

      await callProfile().catch(() => undefined);
      expect(httpService.request).toHaveBeenCalledTimes(1);
    });

    it('não conta falha no circuit breaker (não abre o circuito)', async () => {
      httpService.request.mockReturnValue(fail(axiosError(404, {})));
      for (let i = 0; i < 5; i++) await callProfile().catch(() => undefined);

      expect(failures()).toBe(0);
      httpService.request.mockReturnValue(ok({ id: 'user-id' }));
      await expect(callProfile()).resolves.toEqual({ id: 'user-id' });
    });
  });

  describe('retry', () => {
    it('falhas transitórias: tenta de novo e devolve o sucesso', async () => {
      httpService.request
        .mockReturnValueOnce(
          fail(axiosError(undefined, undefined, 'ECONNRESET')),
        )
        .mockReturnValueOnce(fail(axiosError(503, {})))
        .mockReturnValue(ok({ id: 'user-id' }));

      await expect(callProfile()).resolves.toEqual({ id: 'user-id' });
      expect(httpService.request).toHaveBeenCalledTimes(3);
      expect(failures()).toBe(0);
    });

    it('serviço fora do ar: esgota as tentativas e responde 503', async () => {
      httpService.request.mockReturnValue(
        fail(axiosError(undefined, undefined, 'ECONNREFUSED')),
      );

      await expect(callProfile()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(httpService.request).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('5xx do serviço também é retentado e termina em 503', async () => {
      httpService.request.mockReturnValue(fail(axiosError(500, {})));

      await expect(callProfile()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(httpService.request).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('a resposta de indisponibilidade não expõe a URL interna', async () => {
      httpService.request.mockReturnValue(
        fail(axiosError(undefined, undefined, 'ECONNREFUSED')),
      );

      const error = (await callProfile().catch(
        (e: unknown) => e,
      )) as HttpException;
      expect(JSON.stringify(error.getResponse())).not.toContain('localhost');
    });
  });

  describe('timeout', () => {
    it('tentativa que excede o timeout falha e a próxima é tentada', async () => {
      const timeoutSpy = jest
        .spyOn(TimeoutService.prototype, 'executeWithCustomTimeout')
        .mockRejectedValueOnce(new Error('Operation timed out after 10000ms'));
      httpService.request.mockReturnValue(ok({ id: 'user-id' }));

      await expect(callProfile()).resolves.toEqual({ id: 'user-id' });
      expect(timeoutSpy).toHaveBeenCalledTimes(2); // 1ª estourou, 2ª passou
      expect(timeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        serviceConfig.users.timeout,
      );
    });
  });

  describe('circuit breaker', () => {
    it('abre após 3 requisições falhas e passa a falhar rápido sem chamar o serviço', async () => {
      httpService.request.mockReturnValue(
        fail(axiosError(undefined, undefined, 'ECONNREFUSED')),
      );
      for (let i = 0; i < 3; i++) await callProfile().catch(() => undefined);
      expect(circuitBreaker.getCircuitState('proxy-users')?.state).toBe('OPEN');

      httpService.request.mockClear();
      await expect(callProfile()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(httpService.request).not.toHaveBeenCalled();
    });

    it('após o resetTimeout, uma requisição bem-sucedida fecha o circuito', async () => {
      httpService.request.mockReturnValue(
        fail(axiosError(undefined, undefined, 'ECONNREFUSED')),
      );
      for (let i = 0; i < 3; i++) await callProfile().catch(() => undefined);

      // simula a passagem dos 30s do resetTimeout
      circuitBreaker.getCircuitState('proxy-users')!.nextAttemptTime =
        Date.now() - 1;
      httpService.request.mockReturnValue(ok({ id: 'user-id' }));

      await expect(callProfile()).resolves.toEqual({ id: 'user-id' });
      expect(circuitBreaker.getCircuitState('proxy-users')?.state).toBe(
        'CLOSED',
      );
    });
  });
});
