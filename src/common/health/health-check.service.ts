import { Injectable, Logger } from '@nestjs/common';
import { healthStatus, ServiceHealth } from './health-check.interface';
import { HttpService } from '@nestjs/axios';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { serviceConfig } from '../../config/gateway.config';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class HealthCheckStatus {
  private readonly logger = new Logger(HealthCheckStatus.name); // importamos o log para montar os logs do health
  private readonly healthCache = new Map<string, ServiceHealth>(); // fazemos um cache com o map para esses logs

  //para construir esse service, usamos o http e o circuit Breaker
  constructor(
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  // checo apenas um serviço
  async checkServiceHealth(
    serviceName: keyof typeof serviceConfig,
  ): Promise<ServiceHealth> {
    const service = serviceConfig[serviceName];
    const startTime = Date.now();

    // faço requisição nos serviços e vejo se está tudo ok
    // utilizo o circuitBreaker para executar essa requisição com segurança
    try {
      await this.circuitBreakerService.executeWithCircuitBreaker(
        async () => {
          const response = await firstValueFrom(
            this.httpService
              .get(`${service.url}/health`, {
                timeout: service.timeout,
              })
              .pipe(timeout(service.timeout)),
          );

          return response.status;
        },
        `health-${serviceName}`,
        () => {
          throw new Error('Circuit breaker fallback');
        },
      );
      const responseTime = Date.now() - startTime;
      const serviceHealth: ServiceHealth = {
        name: serviceName,
        url: service.url,
        status: healthStatus.HEALTHY,
        responseTime: responseTime,
        lastCheck: new Date(),
      };
      this.healthCache.set(serviceName, serviceHealth);
      return serviceHealth;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const serviceHealth: ServiceHealth = {
        name: serviceName,
        url: service.url,
        status: healthStatus.UNHEALTHY,
        responseTime: responseTime,
        lastCheck: new Date(),
        error: error.message,
      };
      this.healthCache.set(serviceName, serviceHealth);
      this.logger.error(
        `Health check failed for ${serviceName}:`,
        error.message,
      );
      return serviceHealth;
    }
  }

  // checo todos os serviços de uma vez
  async checkAllServices(): Promise<ServiceHealth[]> {
    const services: (keyof typeof serviceConfig)[] = [
      'users',
      'products',
      'checkout',
      'payment',
    ];

    const healthChecks = await Promise.allSettled(
      services.map((serviceName) => this.checkServiceHealth(serviceName)),
    );

    return healthChecks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: services[index],
          url: serviceConfig[services[index]].url,
          status: healthStatus.UNHEALTHY as const,
          responseTime: 0,
          lastCheck: new Date(),
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }

  // pego o health individualmente de cada serviço guardado em meu cache
  getCachedHealth(serviceName: string): ServiceHealth | undefined {
    return this.healthCache.get(serviceName);
  }

  // pego todos os health guardados no meu cache
  getAllCachedHealth(): ServiceHealth[] {
    return Array.from(this.healthCache.values());
  }
}
