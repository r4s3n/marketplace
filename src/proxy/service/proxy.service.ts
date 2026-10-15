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

// erro (4xx ou 5xx) respondido pelo serviço: ele está no ar e decidiu responder assim
// (ex.: 404, ou 503 porque uma dependência dele caiu), então não indica indisponibilidade
class UpstreamHttpError {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

// só GET é repetido: refazer POST/PUT/PATCH/DELETE após timeout pode duplicar o efeito
const GET_MAX_RETRIES = 4;

// mensagens de indisponibilidade devolvidas ao cliente pelo fallback
const UNAVAILABLE_MESSAGES: Record<keyof typeof serviceConfig, string> = {
  users: 'Serviço de usuários indisponível',
  products: 'Serviço de produtos indisponível',
  checkout: 'Serviço de checkout indisponível',
  payment: 'Serviço de pagamentos indisponível',
};

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

    const isGet = method.toLowerCase() === 'get';
    const cacheKey = this.cacheKey(serviceName, path, userInfo?.userId);
    const fallback = this.createServiceFallback(
      serviceName,
      method,
      path,
      cacheKey,
    ); // nosso fallback

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
                    // o serviço respondeu (4xx ou 5xx): devolvemos como resultado
                    // para não acionar retry nem contar falha no circuit breaker
                    if (isAxiosError(error) && error.response) {
                      const { status, data: body } = error.response;
                      return new UpstreamHttpError(status, body);
                    }
                    throw error; // só rede e timeout seguem para retry/circuit breaker
                  }

                  // se o nosso response for sucesso, eu guardo no cache (chave inclui o usuário)
                  if (isGet) {
                    this.cacheFallbackService.setCacheData(
                      cacheKey,
                      response.data,
                    );
                  }

                  // retorno apenas os dados e não o response completo
                  return response.data;
                },
                service.timeout, // tempo de Timeout
              );
            },
            isGet ? GET_MAX_RETRIES : 0, // MAX retries
          );
        },

        `proxy-${serviceName}`, // key
        fallback, // nosso fallback personalizado
        { failureThreshold: 3, timeout: 30000, resetTimeout: 30000 }, // config
      );

    // repassa ao cliente o mesmo status e corpo do erro respondido pelo serviço
    if (result instanceof UpstreamHttpError) {
      throw new HttpException(
        result.body as Record<string, unknown>,
        result.status,
      );
    }

    return result;
  }

  // usuário na chave: respostas de rotas autenticadas (ex.: /cart) nunca são servidas a outro usuário
  private cacheKey(serviceName: string, path: string, userId?: string) {
    return `${serviceName}:${userId ?? 'public'}:${path}`;
  }

  private createServiceFallback(
    serviceName: keyof typeof serviceConfig,
    method: string,
    path: string,
    cacheKey: string,
  ): () => Promise<unknown> {
    const unavailable = this.defaultFallbackService.createErrorFallback(
      serviceName,
      UNAVAILABLE_MESSAGES[serviceName],
    );

    switch (serviceName) {
      case 'users':
        if (path.includes('/auth/login')) {
          return this.defaultFallbackService.createErrorFallback(
            'users',
            'Serviço de autenticação indisponível',
          );
        }
        return unavailable;

      case 'products':
        if (method.toLowerCase() !== 'get') return unavailable;

        // listas caem no último cache bom ou em [], o mesmo formato do contrato
        if (path === '/products' || path.startsWith('/products/seller/')) {
          return this.cacheFallbackService.createCacheFallback(cacheKey, []);
        }

        // produto único: último cache bom ou 503 (não há valor padrão que faça sentido)
        return async () =>
          (await this.cacheFallbackService.getCachedData(cacheKey, 30000)) ??
          unavailable();

      default:
        return unavailable;
    }
  }
}

// sobre inversão de dependencia, em resumo: quem precisa da dependencia é quem chama ela, e não quem a implementa
// Ou seja, o serviço que precisa de uma dependência, não é ele que vai criar a dependência, e sim quem chama ele
// Isso é feito para desacoplar as classes e facilitar a manutenção do código
