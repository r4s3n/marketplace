import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

const JWT_EXPIRES_IN = 86400; // 24h em segundos

@Module({
  imports: [
    UsersModule, // acesso aos dados de usuário via UsersService
    PassportModule,
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
  providers: [
    AuthService,
    JwtStrategy,
    // guard global: toda rota exige JWT, exceto as marcadas com @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
