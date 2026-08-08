import { Module } from '@nestjs/common';
import { ProxyService } from './service/proxy.service';

@Module({
  providers: [ProxyService]
})
export class ProxyModule {}
