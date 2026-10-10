import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const JWT_EXPIRES_IN = 86400; // 24h em segundos

@Module({
  imports: [
    UsersModule, // acesso aos dados de usuário via UsersService
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        // sem fallback: a aplicação não sobe sem o segredo
        if (!secret) {
          throw new Error('Variável de ambiente JWT_SECRET não definida');
        }
        return { secret, signOptions: { expiresIn: JWT_EXPIRES_IN } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
