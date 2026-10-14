import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProxyModule } from '../proxy/proxy.module';
import { ProductsController } from './products.controller';

// rotas /products/* encaminhadas ao products-service pelo ProxyService
@Module({
  imports: [ProxyModule, AuthModule], // AuthModule registra a JwtStrategy usada pelo guard
  controllers: [ProductsController],
})
export class ProductsModule {}
