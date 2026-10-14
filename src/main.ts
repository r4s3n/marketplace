import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // configurando o CORS para permitir requisições de qualquer origem
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // transforma os dados recebidos para o tipo esperado
      forbidNonWhitelisted: true, // remove propriedades que não estão no DTO
      transform: true, // retorna erro se houver propriedades que não estão no DTO
    }),
  );

  // documentação em /api (registrada fora dos controllers, não passa pelo guard global)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Checkout Service')
    .setDescription('Carrinho e pedidos do marketplace')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Health', 'Health check do serviço')
    .addTag('Cart', 'Carrinho do usuário autenticado')
    .build();
  SwaggerModule.setup(
    'api',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.PORT ?? 3003;
  await app.listen(port);

  console.log(`🛒 Checkout Service running on port ${port}`);
}
void bootstrap();
