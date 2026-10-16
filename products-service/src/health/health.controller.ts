import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

export interface HealthResponse {
  status: 'ok';
  service: 'products-service';
}

// liveness consultado pelo health check do api-gateway: não depende do banco
@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check do serviço' })
  @ApiResponse({
    status: 200,
    description: 'Serviço no ar',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        service: { type: 'string', example: 'products-service' },
      },
    },
  })
  check(): HealthResponse {
    return { status: 'ok', service: 'products-service' };
  }
}
