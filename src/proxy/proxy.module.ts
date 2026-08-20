import { Module } from '@nestjs/common';
import { ProxyService } from './service/proxy.service';
import { HttpModule } from '@nestjs/axios';
import { CicuitBreakerModule } from '../common/circuit-breaker/circuit-breaker.module';
import { FallbackModule } from '../common/fallback/fallback.module';

@Module({
  imports: [HttpModule, CicuitBreakerModule, FallbackModule], // importamos o fallbackModule para usar seus modulos
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
