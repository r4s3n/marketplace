import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProxyModule } from '../proxy/proxy.module';
import { CartProxyController } from './cart-proxy.controller';
import { OrdersProxyController } from './orders-proxy.controller';

// rotas de carrinho e pedidos encaminhadas ao checkout-service pelo ProxyService
@Module({
  imports: [ProxyModule, AuthModule], // AuthModule registra a JwtStrategy usada pelo guard
  controllers: [CartProxyController, OrdersProxyController],
})
export class CheckoutModule {}
