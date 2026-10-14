import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

// só valida tokens emitidos pelo users-service: sem login, registro ou emissão
@Module({
  imports: [PassportModule],
  providers: [
    JwtStrategy,
    // guard global: toda rota exige JWT, exceto as marcadas com @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
