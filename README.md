<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Fluxo E2E com users-service

O gateway (porta 3005) encaminha `/auth/*` e `/users/*` para o users-service (porta 3000). Todas essas rotas passam pelo `ProxyService` (circuit breaker, retry, timeout e fallback), declaradas no `UsersController`. `POST /auth/register` e `POST /auth/login` são públicas e encaminham o corpo sem alterações (a validação é do users-service). `GET /auth/validate-token` e as rotas `/users/*` exigem JWT, que o próprio gateway valida antes de chamar o users-service.

### Pré-requisitos

1. Postgres do users-service no ar: `docker compose up -d` em `users-service/`.
2. `.env` do gateway com `USERS_SERVICE_URL=http://localhost:3000` e **o mesmo `JWT_SECRET` do users-service** (ver `.env.example`).
3. Os dois serviços rodando: `pnpm start:dev` em `users-service/` e em `api-gateway/`.

### Passo a passo (somente pela porta 3005)

```bash
# 1. registra um seller → 201 (sem password na resposta)
curl -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","password":"senha123","firstName":"Maria","lastName":"Silva","role":"seller"}'

# 2. login → 200 com { user, token }
curl -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","password":"senha123"}'

TOKEN=<token retornado no login>

# 3. valida o token → 200 com { userId, email, role }
curl http://localhost:3005/auth/validate-token -H "Authorization: Bearer $TOKEN"

# 4. perfil do usuário logado → 200
curl http://localhost:3005/users/profile -H "Authorization: Bearer $TOKEN"

# 5. vendedores ativos → 200 com array
curl http://localhost:3005/users/sellers -H "Authorization: Bearer $TOKEN"

# 6. sem token ou com token adulterado → 401 (o users-service não é chamado)
curl http://localhost:3005/users/profile
curl http://localhost:3005/users/profile -H "Authorization: Bearer ${TOKEN}x"

# 7. mesmo e-mail de novo → 409 com a mensagem do users-service
curl -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","password":"senha123","firstName":"Maria","lastName":"Silva","role":"seller"}'

# 8. senha errada → 401 com a mensagem do users-service
curl -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","password":"errada123"}'
```

Erros 4xx do users-service (`400`, `401`, `404`, `409`) são repassados pelo `ProxyService` com o mesmo status e corpo, sem retry e sem contar falha no circuit breaker. Com o users-service fora do ar, as rotas respondem `503` (após as tentativas de retry, o que pode levar alguns segundos).

### Health e documentação

```bash
# dispara o health check de todos os serviços (preenche o cache)
curl http://localhost:3005/health/ready

# status do users-service visto pelo gateway → healthy / unhealthy
curl http://localhost:3005/health/services/users

# health direto no users-service
curl http://localhost:3000/health
```

- Swagger do gateway: http://localhost:3005/api
- Swagger do users-service: http://localhost:3000/api

> Atenção: no gateway, `POST /auth/register` é limitado a 3 requisições por minuto e `POST /auth/login` a 5.

## Fluxo E2E com products-service

O gateway encaminha `/products/*` para o products-service (porta 3001). Só `POST /products` exige JWT, validado pelo próprio gateway; as consultas são públicas. A regra "apenas seller cria produto" fica no products-service, e o gateway repassa o `403`.

### Pré-requisitos

1. Postgres do users-service e do products-service no ar: `docker compose up -d` em `users-service/` e em `products-service/`.
2. `.env` do gateway com `PRODUCTS_SERVICE_URL=http://localhost:3001` e **o mesmo `JWT_SECRET` do users-service e do products-service** (ver `.env.example`).
3. Os três serviços rodando: `pnpm start:dev` em `users-service/`, `products-service/` e `api-gateway/`.

### Passo a passo (somente pela porta 3005)

```bash
# 1. login de um seller (registre antes, ver fluxo de users) → 200 com { user, token }
curl -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","password":"senha123"}'

TOKEN=<token retornado no login>

# 2. cria um produto → 201 com sellerId = id do seller e isActive = true
curl -X POST http://localhost:3005/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Teclado mecânico","description":"Teclado ABNT2","price":349.9,"stock":15}'

PRODUCT_ID=<id retornado na criação>
SELLER_ID=<sellerId retornado na criação>

# 3. catálogo (público) → 200 com array contendo o produto
curl http://localhost:3005/products

# 4. produto por id (público) → 200
curl http://localhost:3005/products/$PRODUCT_ID

# 5. produtos do vendedor (público) → 200 com array
curl http://localhost:3005/products/seller/$SELLER_ID

# 6. buyer tentando criar produto → 403 (vem do products-service)
curl -X POST http://localhost:3005/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -d '{"name":"X","description":"Y","price":1,"stock":1}'
```

Erros esperados:

```bash
# sem token ou token adulterado → 401 (o products-service não é chamado)
curl -X POST http://localhost:3005/products -H "Content-Type: application/json" -d '{}'

# corpo inválido → 400 com a lista de mensagens do products-service
curl -X POST http://localhost:3005/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"","price":0,"stock":2.5}'

# id que não é UUID → 400; UUID sem produto → 404
curl http://localhost:3005/products/abc
curl http://localhost:3005/products/00000000-0000-4000-8000-000000000000
```

Com o products-service fora do ar, `POST /products` responde `503`. As consultas `GET` caem no fallback do `ProxyService` e respondem `200` com um objeto padrão (`{ products: [], total: 0, page: 1, limit: 10 }`), não com erro.

### Health e documentação

```bash
# dispara o health check de todos os serviços (preenche o cache)
curl http://localhost:3005/health/ready

# status do products-service visto pelo gateway → healthy / unhealthy
curl http://localhost:3005/health/services/products

# health direto no products-service
curl http://localhost:3001/health
```

- Swagger do products-service: http://localhost:3001/api

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
