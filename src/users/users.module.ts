import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProxyModule } from '../proxy/proxy.module';
import { UsersController } from './users.controller';

// rotas /users/* encaminhadas ao users-service pelo ProxyService
@Module({
  imports: [ProxyModule, AuthModule], // AuthModule registra a JwtStrategy usada pelo guard
  controllers: [UsersController],
})
export class UsersModule {}
