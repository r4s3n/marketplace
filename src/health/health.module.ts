import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { healthCheckModule } from '../common/health/health-check.module';

@Module({
  imports: [healthCheckModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
