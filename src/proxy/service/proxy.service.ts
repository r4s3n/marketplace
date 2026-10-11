import { HttpService } from '@nestjs/axios';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { AxiosResponse, isAxiosError } from 'axios';
import { serviceConfig } from '../../config/gateway.config';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../../common/circuit-breaker/circuit-breaker.service';
import { CacheFallbackService } from '../../common/fallback/cache.fallback';
import { defaultFallbackService } from '../../common/fallback/default.fallback';
import { RetryService } from '../../common/retry/retry.service';
import { TimeoutService } from '../../common/timeout/timeout.service';

// interface que representa as informações do usuário que vão ser passadas para o serviço, caso o usuário esteja logado
interface UserInfo {
  userId?: string;
  email?: string;
  role?: string;
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

// erro 4xx retornado pelo serviço (ex.: 404, 401): não indica indisponibilidade
class UpstreamClientError {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService, // instancio o circuitBreaker dentro do meu proxy
    private readonly cacheFallbackService: CacheFallbackService,
    private readonly defaultFallbackService: defaultFallbackService,
    private readonly retryService: RetryService,
    private readonly timeoutService: TimeoutService,
  ) {}

  // metodo que vai receber a requisição e repassar para o serviço correto
  async proxyRequest(
    serviceName: keyof typeof serviceConfig,
    method: HttpMethod,
    path: string,
    data?: unknown,
    headers?: Record<string, string>,
    userInfo?: UserInfo,
  ) {
    const service = serviceConfig[serviceName];
    const url = `${service.url}${path}`;

    this.logger.log(`Proxying ${method} request to ${serviceName}: ${url}`);

    const fallback = this.createServiceFallback(serviceName, method, path); // nosso fallback

    // PRIMEIRA CAMADA => CIRCUIT BREAKER
    const result: unknown =
      await this.circuitBreakerService.executeWithCircuitBreaker(
        async () => {
          // SEGUNDA CAMADA => RETRY
          return await this.retryService.executeWithExponentialBackoff(
            async () => {
              // TERCEIRA CAMADA => TIMEOUT
              return await this.timeoutService.executeWithCustomTimeout(
                // Operation
                async () => {
                  const enhancedHeaders = {
                    ...headers,
                    'x-user-id': userInfo?.userId,
                    'x-user-email': userInfo?.email,
                    'x-user-role': userInfo?.role,
                  };

                  let response: AxiosResponse;
                  try {
                    response = await firstValueFrom(
                      this.httpService.request({
                        method: method.toLowerCase(),
                        url,
                        data,
                        headers: enhancedHeaders,
                        timeout: service.timeout,
                      }),
                    );
                  } catch (error) {
                    // 4xx é resposta de negócio (serviço saudável): devolvemos como resultado
                    // para não acionar retry nem contar falha no circuit breaker
                    if (isAxiosError(error) && error.response) {
                      const { status, data: body } = error.response;
                      if (status < 500)
                        return new UpstreamClientError(status, body);
                    }
                    throw error; // rede, timeout e 5xx seguem para retry/circuit breaker
                  }

                  // se o nosso response for sucesso, eu guardo no cache
                  if (method.toLowerCase() === 'get') {
                    this.cacheFallbackService.setCacheData(
                      `${serviceName}-${path}`,
                      response.data,
                    );
                  }

                  // retorno apenas os dados e não o response completo
                  return response.data;
                },
                service.timeout, // tempo de Timeout
              );
            },
            4, // MAX retries
          );
        },

        `proxy-${serviceName}`, // key
        fallback, // nosso fallback personalizado
        { failureThreshold: 3, timeout: 30000, resetTimeout: 30000 }, // config
      );

    // repassa ao cliente o mesmo status e corpo do erro 4xx do serviço
    if (result instanceof UpstreamClientError) {
      throw new HttpException(
        result.body as Record<string, unknown>,
        result.status,
      );
    }

    return result;
  }

  private createServiceFallback(
    serviceName: string,
    method: string,
    path: string,
  ) {
    switch (serviceName) {
      case 'users':
        if (path.includes('/auth/login')) {
          return this.defaultFallbackService.createErrorFallback(
            'users',
            'Authentication service unavailable',
          );
        }
        return this.defaultFallbackService.createErrorFallback(
          'users',
          'User service unavailable',
        );

      case 'products':
        if (method.toLowerCase() === 'get') {
          return this.cacheFallbackService.createCacheFallback(
            `Product-${path}`,
            { products: [], total: 0, page: 1, limit: 10 },
          );
        }

        return this.defaultFallbackService.createErrorFallback(
          'products',
          'Product service unavailable',
        );

      case 'checkout':
      case 'payments':
        return this.defaultFallbackService.createErrorFallback(
          serviceName,
          `${serviceName} service unavailable`,
        );
      default:
        return this.defaultFallbackService.createErrorFallback(
          serviceName,
          'Service unavailable',
        );
    }
  }
}

// sobre inversão de dependencia, em resumo: quem precisa da dependencia é quem chama ela, e não quem a implementa
// Ou seja, o serviço que precisa de uma dependência, não é ele que vai criar a dependência, e sim quem chama ele
// Isso é feito para desacoplar as classes e facilitar a manutenção do código
