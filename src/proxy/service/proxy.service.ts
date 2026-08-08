import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { serviceConfig } from '../../config/gateway.config';
import { firstValueFrom } from 'rxjs';

interface UserInfo {
  userId?: string;
  email?: string;
  role?: string;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly httpService: HttpService) {}

  // metodo que vai receber a requisição e repassar para o serviço correto
  async proxyRequest(
    serviceName: keyof typeof serviceConfig,
    method: string,
    path: string,
    data?: unknown, // uso o uknown pq não sei o tipo de dado que vai ser enviado, pode ser qualquer coisa
    headers?: Record<string, string>, // o record é um tipo de dado que representa um objeto com chaves e valores, nesse caso, as chaves são strings e os valores também são strings
    userInfo?: UserInfo,
  ) {
    const service = serviceConfig[serviceName];
    const url = `${service.url}${path}`;

    this.logger.log(`Proxying ${method} request to ${serviceName}: ${url}`);

    try {
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
    } catch (error) {
      this.logger.error(
        `Error Proxying ${method} request to ${serviceName}: ${url}`,
      );
      throw error;
    }
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
