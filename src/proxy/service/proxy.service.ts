import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { serviceConfig } from '../../config/gateway.config';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../../common/circuit-breaker/circuit-breaker.service';

// interface que representa as informações do usuário que vão ser passadas para o serviço, caso o usuário esteja logado
interface UserInfo {
  userId?: string;
  email?: string;
  role?: string;
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService, // instancio o circuitBreaker dentro do meu proxy
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

    return this.circuitBreakerService.executeWithCircuitBreaker(
      async () => {
        // nossa operação
        const enhancedHeaders = {
          ...headers,
          'x-user-id': userInfo?.userId,
          'x-user-email': userInfo?.email,
          'x-user-role': userInfo?.role,
        };

        const response = await firstValueFrom(
          this.httpService.request({
            method: method.toLowerCase(),
            url,
            data,
            headers: enhancedHeaders,
            timeout: service.timeout,
          }),
        );

        return response;
      },
      `proxy-${serviceName}`, // key
      () => {
        // nosso fallback
        throw new Error(
          `Error Proxying ${method} request to ${serviceName}: ${url}`,
        );
      },
      { failureThreshold: 3, timeout: 30000, resetTimeout: 30000 }, // config
    );
  }

  // metodo que vai verificar a saúde do serviço, se está online ou não
  async getServiceHealth(serviceName: keyof typeof serviceConfig) {
    try {
      const service = serviceConfig[serviceName];

      const response = await firstValueFrom(
        // tipo o response para que o typescript saiba que o retorno da requisição vai ser um objeto com a propriedade status do tipo string
        this.httpService.get<{ status: string }>(`${service.url}/health`, {
          timeout: 3000,
        }),
      );

      return { status: 'healthy', data: response.data };
    } catch (error) {
      // faço um type guard para verificar se o erro é uma instância de Error, caso seja, pego a mensagem do erro, caso não seja, retorno uma mensagem padrão
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 'unhealthy', error: message };
    }
  }
}

// sobre inversão de dependencia, em resumo: quem precisa da dependencia é quem chama ela, e não quem a implementa
// Ou seja, o serviço que precisa de uma dependência, não é ele que vai criar a dependência, e sim quem chama ele
// Isso é feito para desacoplar as classes e facilitar a manutenção do código
