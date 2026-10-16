import { Module } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';
import { HttpModule } from '@nestjs/axios';
import { CicuitBreakerModule } from '../circuit-breaker/circuit-breaker.module';

@Module({
  imports: [HttpModule, CicuitBreakerModule],
  providers: [HealthCheckService],
  exports: [HealthCheckService],
})
export class healthCheckModule {}
