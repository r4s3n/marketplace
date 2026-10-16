import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggingMiddleware } from './logging/logging.middleware';

@Module({
  imports: [
    // evita ataques, coloca um ratelimit em nossa aplicação
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minuto
        limit: 100, // 100 request por minuto
      },
    ]),
  ],
  providers: [LoggingMiddleware],
})
export class MiddlewareModule {}
