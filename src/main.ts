import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // configurando o CORS para permitir requisições de qualquer origem
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove propriedades que não estão no DTO
      forbidNonWhitelisted: true, // retorna erro se houver propriedades que não estão no DTO
      transform: true, // transforma os dados recebidos para o tipo esperado
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`👤 Users Service running on port ${port}`);
}
void bootstrap();
