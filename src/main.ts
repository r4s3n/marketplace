import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// a função bootstrap é responsável por iniciar a aplicação
// ela é chamada quando o arquivo main.ts é executado
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet()); // adicionando o helmet para aumentar a segurança da aplicação

  // configurando o CORS para permitir requisições de qualquer origem
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*', // permitindo requisições de qualquer origem
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // permitindo os métodos HTTP mais comuns
    allowedHeaders: ['Content-Type', 'Authorization'], // permitindo os headers mais comuns
  });

  // configurando o pipe de validação global para validar os dados recebidos em todas as rotas
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // transforma os dados recebidos para o tipo esperado
      whitelist: true, // remove propriedades que não estão no DTO
      forbidNonWhitelisted: true, // retorna erro se houver propriedades que não estão no DTO
    }),
  );

  // configurando o Swagger para gerar a documentação da API
  const config = new DocumentBuilder()
    .setTitle('Marketplace API Gateway')
    .setDescription('API Gateway para o projeto de microserviços')
    .setVersion('1.0')
    .addBearerAuth() // adicionando autenticação via Bearer Token
    .build();

  // criando o documento do Swagger com base na configuração acima
  const document = SwaggerModule.createDocument(app, config); // criando o documento do Swagger com base na configuração acima
  SwaggerModule.setup('api', app, document); // configurando a rota /api para acessar a documentação do Swagger

  const port = process.env.PORT || 3005; // definindo a porta da aplicação
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`); // exibindo a URL da aplicação no console
  console.log(`Swagger is running on: http://localhost:${port}/api`); // exibindo a URL da documentação do Swagger no console
}

bootstrap();
