import { Controller, Get, Param } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthCheckService } from '../common/health/health-check.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { healthStatus } from '../common/health/health-check.interface';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check do gateway' })
  @ApiResponse({ status: 200, description: 'Gateway está saudável' })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_config_user_agent,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Health check de todos os serviços' })
  @ApiResponse({ status: 200, description: 'Status de todos os serviços' })
  async getServicesHealth() {
    const services = await this.healthCheckService.checkAllServices();

    const overallStatus = services.every(
      (s) => s.status === healthStatus.HEALTHY,
    )
      ? 'healthy'
      : services.every((s) => s.status === healthStatus.HEALTHY)
        ? 'degraded'
        : 'unhealthy';

    return {
      overallStatus,
      timestamp: new Date().toISOString(),
      services,
      summary: {
        total: services.length,
        healthy: services.filter((s) => s.status === healthStatus.HEALTHY)
          .length,
        unhealthy: services.filter((s) => s.status === healthStatus.UNHEALTHY)
          .length,
        degraded: services.filter((s) => s.status === healthStatus.DEGRADED)
          .length,
      },
    };
  }

  @Get('services/:serviceName')
  @ApiOperation({ summary: 'Health check de um serviço específico' })
  @ApiResponse({ status: 200, description: 'Status do serviço' })
  getServiceHealth(@Param('serviceName') serviceName: string) {
    const cached = this.healthCheckService.getCachedHealth(serviceName);

    if (!cached) {
      return {
        status: 'unknown',
        message: 'Service not found or never check',
        timestamp: new Date().toISOString(),
      };
    }

    return cached;
  }

  // rotas para os orquestadores
  @Get('ready')
  @ApiOperation({ summary: 'Get readiness status' })
  @ApiResponse({
    status: 200,
    description: 'Readiness status retrieved successfally',
  })
  async getReady() {
    const ready = await this.healthService.getReadyStatus();
    return ready;
  }

  @Get('live')
  @ApiOperation({ summary: 'Get liveness status' })
  @ApiResponse({
    status: 200,
    description: 'Livemess status retrieved successfully',
  })
  getLive() {
    const lived = this.healthService.getLiveStatus();
    return lived;
  }
}
