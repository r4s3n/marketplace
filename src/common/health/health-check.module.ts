import { Module } from '@nestjs/common';
import { HealthCheckStatus } from './health-check.service';

@Module({
  providers: [HealthCheckStatus],
  exports: [HealthCheckStatus],
})
export class healthCheckModule {}
