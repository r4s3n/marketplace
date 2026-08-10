import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProxyModule } from './proxy/proxy.module';
import { MiddlewareModule } from './middleware/middleware.module';
import { LoggingMiddleware } from './middleware/logging/logging.middleware';

@Module({
  imports: [
    // fazendo com que o módulo de configuração seja global, ou seja, disponível em toda a aplicação
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // configurando o módulo de limitação de requisições
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minuto
        limit: 100, // 100 request por minuto
      },
    ]),
    ProxyModule,
    MiddlewareModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
// importamos o NestModule, nele temos uma função chamada configure, essa função existe para que configuramos nosso middleware para toda a aplicação
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // aplicamos nosso middleware para toda as rotas
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
