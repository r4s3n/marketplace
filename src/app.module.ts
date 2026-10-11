import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProxyModule } from './proxy/proxy.module';
import { MiddlewareModule } from './middleware/middleware.module';
import { LoggingMiddleware } from './middleware/logging/logging.middleware';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './guards/throttler.guard';
import { HealthModule } from './health/health.module';
import { healthCheckModule } from './common/health/health-check.module';
import { FallbackModule } from './common/fallback/fallback.module';
import { CicuitBreakerModule } from './common/circuit-breaker/circuit-breaker.module';
import { TimeoutModule } from './common/timeout/timeout.module';
import { RetryModule } from './common/retry/retry.module';
import { TimeoutService } from './common/timeout/timeout.service';
import { RetryService } from './common/retry/retry.service';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // fazendo com que o módulo de configuração seja global, ou seja, disponível em toda a aplicação
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // configurando o módulo de limitação de requisições
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: configService.get<number>('RATE_LIMIT_SHORT', 10),
        },
        {
          name: 'medium',
          ttl: 60000, // 1 minuto
          limit: configService.get<number>('RATE_LIMIT_MEDIUM', 100),
        },
        {
          name: 'long',
          ttl: 900000, // 15 minuto
          limit: configService.get<number>('RATE_LIMIT_LONG', 1000),
        },
      ],
      inject: [ConfigService],
    }),
    ProxyModule,
    MiddlewareModule,
    AuthModule,
    HealthModule,
    healthCheckModule,
    FallbackModule,
    CicuitBreakerModule,
    TimeoutModule,
    RetryModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    TimeoutService,
    RetryService,
  ],
})
// importamos o NestModule, nele temos uma função chamada configure, essa função existe para que configuramos nosso middleware para toda a aplicação
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // aplicamos nosso middleware para toda as rotas
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
