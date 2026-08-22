import { Injectable } from '@nestjs/common';
import { HealthCheckService } from '../common/health/health-check.service';
import { healthStatus } from '../common/health/health-check.interface';

@Injectable()
export class HealthService {
  constructor(private readonly healthCheckService: HealthCheckService) {}
  // checo todos nossos serviços
  async getHealthStatus() {
    const healthChecks = await this.healthCheckService.checkAllServices();
    const result = {
      status: healthStatus.HEALTHY,
      timestamp: new Date().toISOString(),
      gateway: {
        status: healthStatus.HEALTHY,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      services: {},
    };

    let hasUnhealthyServices = false;

    healthChecks.forEach((serviceHealth) => {
      result.services[serviceHealth.name] = {
        status: serviceHealth.status,
        responseTime: serviceHealth.responseTime,
        lastCheck: serviceHealth.lastCheck,
        url: serviceHealth.url,
        ...(serviceHealth.error && { error: serviceHealth.error }),
      };

      if (serviceHealth.status === healthStatus.UNHEALTHY) {
        hasUnhealthyServices = true;
      }
    });

    if (hasUnhealthyServices) {
      result.status = healthStatus.DEGRADED;
    }

    return result;
  }

  // de todos os serviços que chequei, vejo se eles estão prontos para receber requisições
  async getReadyStatus() {
    const healthStatusReady = await this.getHealthStatus();

    return {
      status:
        healthStatusReady.status === healthStatus.HEALTHY
          ? 'ready'
          : 'not_ready',
      timestamp: new Date().toISOString(),
    };
  }

  // só vejo se a minha aplicação está viva, *uso orquestrador*
  getLiveStatus() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
