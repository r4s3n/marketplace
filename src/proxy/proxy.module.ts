import { Module } from '@nestjs/common';
import { ProxyService } from './service/proxy.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule], // tenho que importar o HttpModule para poder fazer requisições HTTP para os serviços
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
