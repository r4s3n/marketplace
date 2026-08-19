import { Module } from '@nestjs/common';
import { ProxyService } from './service/proxy.service';
import { HttpModule } from '@nestjs/axios';
import { CicuitBreakerModule } from '../common/circuit-breaker/circuit-breaker.module';

@Module({
  imports: [HttpModule, CicuitBreakerModule], // tenho que importar o HttpModule para poder fazer requisições HTTP para os serviços
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
