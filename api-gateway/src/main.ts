import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// a função bootstrap é responsável por iniciar a aplicação
// ela é chamada quando o arquivo main.ts é executado
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // adicionando o helmet para aumentar a segurança da aplicação
  // configuramos um capeçalho CSP -> Previni ataques cross-site scripting
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"], // padrão de escrita, fonte, script. etc. Self permite apenas recursos desta origin
          scriptSrc: ["'self'"], // fonte de script javaScript, só podemos permitir da mesma origin. DANGER.
          styleSrc: ["'self'", "'unsafe-inline'"], // fonte de estilos css, permitimos recursos desta mesma origin e tbm inline
          imgSrc: ["'self'", "'data:'", "'https:'"], // imagens, permitido da mesma origem, banco de dados e vindas do https
        },
      },
      crossOriginEmbedderPolicy: false, // isola alguns recursos origin mas como todas as requsisições tem que enviar um cabeçalho COEP e isso pode quebrar nossa aplicação
      // configura um cabeçaro http -> força que todos os navegadores use https para se conectar com a gente
      hsts: {
        maxAge: 31536000, // tempo maximo da requisição
        includeSubDomains: true, // aplica para todos os dominios
        preload: true, // permite que o dominio seja adicionado na lista de pre-carregamento no navegador
      },
    }),
  );

  // configurando o CORS para permitir requisições de qualquer origem
  app.enableCors({
    origin: (
      origin: string | undefined, // tipamos como string ou undefined
      //tipamos como uma função que recebe erro ou null, um boleando e que não retorna nada
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || ['*'];
      // se o endereço da origin passado for * ou está dentro de allowedOrigins
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true); // pode passar
      } else {
        // se não, retornamos um erro, não precisamos colocar false porq o cors já identifica como false se tiver um erro
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET,HEAD,PUT,PATCH,POST,DELETE'], // permitindo os métodos HTTP mais comuns
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-with',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
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
    .setDescription(
      `
      API Gateway para o sistema de Marketplace com microserviços

      Serviços Disponíveis:
      - Users Service: Autenticação e gestão de usuários
      - Products Service: Catálogo e gestão de produtos
      - Checkout Service: Carrinho e processamento de pedidos
      - Payments Service: Processamento de pagamentos

      Autenticação:
      - Use JWT Bearer token para rotas protegidas
      - Use Session token para validação de sessão
    `,
    )
    .setVersion('1.0')
    .setContact(
      'MarketPlace Team',
      'https://marketplace.com',
      'dev@marketplace.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      // Authorize
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    ) // adicionando autenticação via Bearer Token
    .addApiKey(
      // quais as chaves que nosso projeto precisa -> fica em authorize
      {
        type: 'apiKey',
        name: 'x-session-token',
        in: 'header',
        description: 'Session token for user validation',
      },
      'session-auth',
    )
    .addTag('Authentication', 'Endpoints para autenticação e autorização')
    .addTag('Users', 'Endpoints para gestão de usuários')
    .addTag('Products', 'Endpoints para catálogo de produtos')
    .addTag('Checkout', 'Endpoints para carrinho e pedidos')
    .addTag('Payments', 'Endpoints para processamento de pagamentos')
    .addTag('Health', 'Endpoints para monitoramento de saúde')
    .build();

  // criando o documento do Swagger com base na configuração acima
  const document = SwaggerModule.createDocument(app, config); // criando o documento do Swagger com base na configuração acima
  SwaggerModule.setup('api', app, document); // configurando a rota /api para acessar a documentação do Swagger

  const port = process.env.PORT || 3005; // definindo a porta da aplicação
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`); // exibindo a URL da aplicação no console
  console.log(`📖 Swagger is running on: http://localhost:${port}/api`); // exibindo a URL da documentação do Swagger no console
}

bootstrap();
