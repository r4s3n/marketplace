import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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

  // documentação em /api (registrada fora dos controllers, não passa pelo guard global)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Users Service')
    .setDescription('Registro, autenticação JWT e consulta de usuários')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Registro, login e validação de token')
    .addTag('Users', 'Consulta de usuários')
    .addTag('Health', 'Health check do serviço')
    .build();
  SwaggerModule.setup(
    'api',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`👤 Users Service running on port ${port}`);
}
void bootstrap();
