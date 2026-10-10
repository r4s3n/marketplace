import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule], // acesso aos dados de usuário via UsersService
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
