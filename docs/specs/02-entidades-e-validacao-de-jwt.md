# SPEC: Entidades de domínio e validação de JWT no checkout-service

| Campo        | Valor                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Serviço      | checkout-service                                                                        |
| Sistema      | marketplace-ms                                                                          |
| Tipo         | Modelagem de dados / autenticação / observabilidade / documentação de API               |
| Status       | Pronta para planejamento                                                                |
| Data         | 2026-10-14                                                                              |
| Depende de   | `01-correcao-de-portas-e-configuracao-de-banco.md` (checkout-service), `02-validacao-de-jwt.md` e `05-integracao-com-api-gateway.md` (products-service) |

---

## 1. Objetivo

Preparar o checkout-service (porta 3003) para receber os endpoints de carrinho e pedidos nas próximas specs:

1. Criar as entidades de domínio **Cart**, **CartItem** e **Order**, para que o TypeORM crie as tabelas no `checkout_db`.
2. Proteger todas as rotas do serviço com JWT, aceitando **apenas** tokens emitidos pelo users-service (secure by default).
3. Expor um health check público e a documentação Swagger.

Ao final desta spec, o serviço sobe com as três tabelas criadas e com toda rota protegida, exceto `GET /health`. Ele ainda **não** tem nenhum endpoint de carrinho ou pedido.

## 2. Ponto de partida

### 2.1 O que já existe

- Scaffold NestJS com `ConfigModule.forRoot({ isGlobal: true })` como primeiro import do `AppModule`.
- `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })` conectando ao `checkout-db` (spec 01).
- `EventsModule` com `RabbitmqService` e `PaymentQueueService`.
- `AppController` com `GET /` (Hello World) e `POST /test/send-message` (publica uma mensagem de teste no RabbitMQ).
- As dependências `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` **já estão declaradas** no `package.json`, nas mesmas versões do products-service.

### 2.2 Diagnóstico do pedido x código atual

| #  | Pedido / suposição                                       | Estado real no código                                                                                                                  | Decisão                                                                                     |
| -- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| D1 | PostgreSQL do checkout na porta **5436**.                | O checkout usa **5435** (compose, `.env` e fallback, alinhados na spec 01). A 5436 é do products-service.                               | **Não** alterar a porta. Esta spec não mexe na conexão.                                     |
| D2 | Instalar as dependências de JWT.                         | `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` já existem. Faltam `@types/passport-jwt` (dev) e `@nestjs/swagger`.        | Adicionar só as que faltam (RF-01).                                                          |
| D3 | `JWT_SECRET` configurado.                                | A chave existe no `.env` e no `.env.example`, mas o `.env` está com o valor **vazio**.                                                  | Preencher o `.env` com o valor do users-service (RF-02).                                     |

### 2.3 Lacunas que impedem a criação das tabelas

| #  | Lacuna                                                                                                                                                                                                                       | Tratada em |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| L1 | Não existe nenhum arquivo `*.entity` no projeto: o TypeORM conecta, mas não cria tabelas.                                                                                                                                     | RF-03 a RF-06 |
| L2 | O glob de entidades em `database.config.ts` está como `*.entity{.ts,js}` (falta o ponto antes de `js`). O `nest start` roda o código compilado em `dist/`, onde as entidades são `.entity.js`; com esse glob elas **não são encontradas** e as tabelas não são criadas. A spec 01 deixou essa correção para depois; agora ela é necessária. | RF-07      |

## 3. Escopo

### Dentro do escopo

- Entidades `Cart`, `CartItem` e `Order`, com os enums de status.
- `CartModule` e `OrdersModule`, registrando as entidades com `TypeOrmModule.forFeature`.
- Correção do glob de entidades.
- `AuthModule` com `JwtStrategy`, `JwtAuthGuard` global e `@Public()`, copiando o products-service.
- `HealthModule` com `GET /health` público.
- Swagger em `/api`.
- Registro de todos os módulos no `AppModule`.
- Ajuste do teste e2e existente e testes novos de auth e health.

### Fora do escopo

- Qualquer endpoint de carrinho ou pedido (CRUD, adicionar item, checkout, listar pedidos). Isso fica para as próximas specs.
- Services, controllers e DTOs de `cart` e `orders`.
- Cálculo de `subtotal` e `total`, regras de status e integração com o products-service para buscar preço e nome.
- **Qualquer** alteração no `EventsModule`, no `RabbitmqService`, no `PaymentQueueService` ou na interface `PaymentOrderMessage`.
- Migrations. O schema continua sendo criado pelo `synchronize` em desenvolvimento.
- Emissão de token, login e registro (ficam no users-service).
- RoleGuard ou restrição por role.
- Integração do checkout-service com o api-gateway.
- Alterações no users-service, no products-service, no payments-service e no api-gateway.

---

## 4. Requisitos funcionais: dependências e configuração

### RF-01: Dependências do projeto

1. **RF-01.1**: adicionar `@nestjs/swagger` (runtime) e `@types/passport-jwt` (desenvolvimento), nas **mesmas versões** declaradas no `package.json` do products-service.
2. **RF-01.2**: não alterar as versões de `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt`, que já são iguais às do products-service.
3. **RF-01.3**: nenhuma outra dependência é adicionada nesta spec.

### RF-02: Variável de ambiente `JWT_SECRET`

1. **RF-02.1**: o secret usado para validar o token vem **exclusivamente** da variável `JWT_SECRET`. Nenhum valor de secret fica no código.
2. **RF-02.2**: o valor no `.env` local deve ser **idêntico** ao `JWT_SECRET` do users-service (e do products-service).
3. **RF-02.3**: sem `JWT_SECRET`, ou com a variável vazia, a aplicação **não sobe** e mostra um erro claro no console. Não existe valor padrão.
4. **RF-02.4**: o `.env.example` mantém a chave `JWT_SECRET` sem valor (já está assim).

## 5. Requisitos funcionais: entidades

Regras que valem para as três entidades:

- **RE-01**: chave primária UUID gerada pelo banco.
- **RE-02**: colunas decimais com precisão 10 e escala 2. Como o driver `pg` devolve decimal como texto, a entidade converte o valor para **número** na leitura, como o `price` do `Product` no products-service.
- **RE-03**: `createdAt` e `updatedAt` são preenchidos e atualizados automaticamente pelo TypeORM.
- **RE-04**: `userId` é o UUID do usuário do users-service, guardado como coluna simples, **sem FK**, porque fica em outro banco. O mesmo vale para `productId`, que vem do products-service.
- **RE-05**: os status são enums TypeScript locais do checkout-service, persistidos como tipo `enum` do PostgreSQL.
- **RE-06**: nomes de tabela no plural e em snake_case: `carts`, `cart_items` e `orders`. Nomes de coluna iguais aos nomes das propriedades (camelCase), como no products-service.

### RF-03: Enum `CartStatus`

Valores exatos: `active`, `completed` e `abandoned`.

### RF-04: Entidade `Cart` (tabela `carts`)

| Propriedade | Tipo no banco          | Obrigatório | Padrão   | Observação                                                         |
| ----------- | ---------------------- | ----------- | -------- | ------------------------------------------------------------------ |
| `id`        | uuid                   | sim         | gerado   | Chave primária.                                                    |
| `userId`    | uuid                   | sim         | —        | Dono do carrinho (RE-04).                                          |
| `status`    | enum `CartStatus`      | sim         | `active` |                                                                    |
| `total`     | decimal(10,2)          | sim         | `0`      | Lido como número (RE-02).                                          |
| `items`     | relação 1:N `CartItem` | —           | —        | Não é coluna. Com **cascade** e **eager**.                          |
| `createdAt` | timestamp              | sim         | automático |                                                                  |
| `updatedAt` | timestamp              | sim         | automático |                                                                  |

1. **RF-04.1**: a relação `items` é o lado inverso da relação `cart` do `CartItem`.
2. **RF-04.2**: **cascade**: salvar um `Cart` com itens novos ou alterados persiste esses itens, sem precisar salvá-los separadamente.
3. **RF-04.3**: **eager**: ao buscar um `Cart` pelo repositório, os `items` vêm carregados automaticamente.

### RF-05: Entidade `CartItem` (tabela `cart_items`)

| Propriedade   | Tipo no banco          | Obrigatório | Padrão     | Observação                                                         |
| ------------- | ---------------------- | ----------- | ---------- | ------------------------------------------------------------------ |
| `id`          | uuid                   | sim         | gerado     | Chave primária.                                                    |
| `cart`        | relação N:1 `Cart`     | —           | —          | Não é uma coluna própria: usa a coluna `cartId`.                   |
| `cartId`      | uuid                   | sim         | —          | FK para `carts.id` com **ON DELETE CASCADE**.                      |
| `productId`   | uuid                   | sim         | —          | Produto do products-service (RE-04).                               |
| `productName` | varchar(255)           | sim         | —          | Cópia do nome do produto no momento da adição.                     |
| `price`       | decimal(10,2)          | sim         | —          | Cópia do preço unitário no momento da adição. Lido como número.    |
| `quantity`    | int                    | sim         | `1`        |                                                                    |
| `subtotal`    | decimal(10,2)          | sim         | —          | Lido como número. O cálculo fica para as próximas specs.           |
| `createdAt`   | timestamp              | sim         | automático |                                                                    |

1. **RF-05.1**: a relação `cart` e a propriedade `cartId` usam **a mesma coluna** `cartId` no banco. Não pode existir uma segunda coluna de FK, como `cart_id`.
2. **RF-05.2**: a FK de `cartId` para `carts` tem `ON DELETE CASCADE`: apagar um carrinho apaga os itens dele no banco.
3. **RF-05.3**: `CartItem` **não** tem `updatedAt`.

### RF-06: Enum `OrderStatus` e entidade `Order` (tabela `orders`)

Valores exatos de `OrderStatus`: `pending`, `paid`, `failed` e `cancelled`.

| Propriedade     | Tipo no banco       | Obrigatório | Padrão     | Observação                                                       |
| --------------- | ------------------- | ----------- | ---------- | ---------------------------------------------------------------- |
| `id`            | uuid                | sim         | gerado     | Chave primária.                                                  |
| `userId`        | uuid                | sim         | —          | Comprador (RE-04).                                               |
| `cartId`        | uuid                | sim         | —          | Carrinho que originou o pedido. Coluna simples, sem relação mapeada e sem FK. |
| `total`         | decimal(10,2)       | sim         | —          | Lido como número.                                                |
| `status`        | enum `OrderStatus`  | sim         | `pending`  |                                                                  |
| `paymentMethod` | varchar(50)         | sim         | —          | Ex.: `credit_card`, o mesmo valor que vai na mensagem de pagamento. |
| `items`         | relação 1:N `OrderItem` | —       | —          | Não é coluna. Com **cascade** e **eager** (adicionado na seção 16). |
| `createdAt`     | timestamp           | sim         | automático |                                                                  |
| `updatedAt`     | timestamp           | sim         | automático |                                                                  |

### RF-06A: Entidade `OrderItem` (tabela `order_items`, adicionada na seção 16)

Cópia dos itens do carrinho no fechamento do pedido. Mesmas colunas do `CartItem`, trocando `cart`/`cartId` por `order`/`orderId`:

- `orderId` (uuid) é FK para `orders.id` com **ON DELETE CASCADE**, e a relação `order` usa a mesma coluna.
- `productId` (uuid), `productName` (varchar 255), `price` e `subtotal` (decimal 10,2, lidos como número), `quantity` (int, obrigatório e sem padrão) e `createdAt`.
- Sem `updatedAt`: o item do pedido não muda depois de criado.

### RF-07: Carregamento das entidades

1. **RF-07.1**: corrigir o glob de entidades em `database.config.ts` para encontrar arquivos `.entity.ts` **e** `.entity.js`, igual ao products-service.
2. **RF-07.2**: os demais campos do `databaseConfig` (host, porta 5435, credenciais, `synchronize`, `logging`) não mudam.
3. **RF-07.3**: com o serviço rodando em desenvolvimento, o `synchronize` cria as tabelas `carts`, `cart_items`, `orders` e `order_items` e os tipos enum de status no `checkout_db`.

## 6. Requisitos funcionais: módulos de domínio

### RF-08: `CartModule`

1. **RF-08.1**: módulo em `src/cart/` que registra `Cart` e `CartItem` com `TypeOrmModule.forFeature`, deixando os dois repositórios disponíveis para injeção dentro do módulo.
2. **RF-08.2**: sem controllers, services ou rotas nesta spec.

### RF-09: `OrdersModule`

1. **RF-09.1**: módulo em `src/orders/` que registra `Order` e `OrderItem` com `TypeOrmModule.forFeature`.
2. **RF-09.2**: sem controllers, services ou rotas nesta spec.

## 7. Requisitos funcionais: autenticação JWT

A implementação **copia a abordagem do products-service** (spec `02-validacao-de-jwt.md` dele):

- mesma organização de pastas em `src/auth/` (`strategies/`, `guards/`, `decorators/`, `interfaces/`, `enums/`) e os mesmos nomes de arquivo;
- mesmos nomes de classe, de decorator e de chave de metadata (`JwtStrategy`, `JwtAuthGuard`, `@Public()`, `isPublic`);
- mesmo formato de `req.user` (`id`, `email`, `role`);
- mesmo estilo de testes unitários e e2e;
- comentários curtos em português, como no restante do código.

O checkout-service **não emite tokens**: não existe `AuthController`, `AuthService` nem configuração de assinatura ou expiração. A chave `JWT_EXPIRES_IN` do `.env.example` continua sem uso.

### RF-10: Contratos de dados do token

1. **RF-10.1**: tipo do **payload do token** com `sub` (UUID), `email` e `role`, igual ao do products-service.
2. **RF-10.2**: tipo do **usuário autenticado** (`req.user`) com `id`, `email` e `role`.
3. **RF-10.3**: enum local de roles com exatamente os valores `seller` e `buyer`. O checkout-service **não** importa código de outro serviço.

### RF-11: `JwtStrategy`

1. **RF-11.1**: extrai o token **apenas** do header `Authorization`, no formato `Bearer <token>`.
2. **RF-11.2**: valida a **assinatura** com o `JWT_SECRET` (RF-02) e a **expiração**. Tokens expirados são rejeitados.
3. **RF-11.3**: monta `req.user` mapeando `sub` para `id` e repassando `email` e `role`. Nenhum outro campo do payload (`iat`, `exp` ou extras) aparece em `req.user`.
4. **RF-11.4**: não acessa banco nem chama outros serviços (validação stateless).
5. **RF-11.5**: não restringe por role. Tokens de `seller` e de `buyer` são igualmente válidos.

### RF-12: `JwtAuthGuard` global

1. **RF-12.1**: baseado no guard do Passport, usando a estratégia `jwt`.
2. **RF-12.2**: antes de exigir o token, verifica o metadata `isPublic` no método e na classe. A marcação do método tem prioridade sobre a do controller.
3. **RF-12.3**: em rota pública, libera o acesso **sem olhar** o header `Authorization`. Um token inválido enviado a uma rota pública não causa erro.
4. **RF-12.4**: qualquer falha de autenticação responde **401 Unauthorized** no formato padrão do NestJS (`statusCode` e `message`), sem stack trace e sem o motivo técnico da biblioteca (ex.: "jwt expired").
5. **RF-12.5**: registrado como **guard global** via `APP_GUARD`. Nenhum controller declara o guard individualmente.

### RF-13: Decorator `@Public()`

1. **RF-13.1**: marca uma rota como pública usando o metadata `isPublic` com valor verdadeiro.
2. **RF-13.2**: a chave `isPublic` é definida em **um único lugar** e reutilizada pelo decorator e pelo guard.
3. **RF-13.3**: funciona aplicado em um método (só aquela rota) ou em um controller (todas as rotas da classe).

### RF-14: `AuthModule`

1. **RF-14.1**: módulo em `src/auth/` que reúne o suporte do Passport, a `JwtStrategy` e o `JwtAuthGuard` global.
2. **RF-14.2**: sem controllers e sem rotas.
3. **RF-14.3**: não configura emissão de tokens. O `@nestjs/jwt` só é usado nos testes, para gerar tokens no mesmo formato e com o mesmo secret do users-service.

### RF-15: Rotas existentes

1. **RF-15.1**: `GET /` e `POST /test/send-message` do `AppController` **não** recebem `@Public()` e passam a exigir token.
2. **RF-15.2**: o comportamento de `POST /test/send-message` com token válido não muda: continua publicando a mensagem no RabbitMQ.
3. **RF-15.3**: o teste e2e existente de `GET /` é ajustado para o novo comportamento: sem token, a resposta é 401.
4. **RF-15.4**: o teste unitário existente do `AppController` (com o mock de `PaymentQueueService`) continua passando sem alterações.

## 8. Requisitos funcionais: health check e Swagger

### RF-16: Health check

1. **RF-16.1**: `HealthModule` em `src/health/` com a rota `GET /health`, no mesmo padrão do products-service.
2. **RF-16.2**: a rota é **pública** (`@Public()`) e responde **200** com o corpo exato `{ "status": "ok", "service": "checkout-service" }`.
3. **RF-16.3**: é um liveness simples. Não consulta o banco nem o RabbitMQ.
4. **RF-16.4**: aparece no Swagger com a tag `Health`, um resumo da operação e o exemplo da resposta 200.

### RF-17: Swagger

1. **RF-17.1**: documentação configurada no `main.ts` e servida em **`/api`**, como no products-service.
2. **RF-17.2**: título `Checkout Service`, descrição curta do serviço (carrinho e pedidos do marketplace), versão `1.0`, autenticação Bearer habilitada e a tag `Health`.
3. **RF-17.3**: `/api` abre **sem token**. O Swagger é registrado fora dos controllers e não passa pelo guard global.
4. **RF-17.4**: o fallback da porta no `main.ts` passa de `3000` para **`3003`**, a porta do serviço. Hoje ele coincide com a porta do users-service.
5. **RF-17.5**: o restante do bootstrap (CORS, `ValidationPipe`, log de inicialização) não muda.

## 9. Registro no `AppModule`

### RF-18: Módulos registrados

1. **RF-18.1**: o `AppModule` passa a importar `CartModule`, `OrdersModule`, `AuthModule` e `HealthModule`.
2. **RF-18.2**: `ConfigModule.forRoot({ isGlobal: true })` continua sendo o **primeiro** import, seguido do `TypeOrmModule.forRootAsync`.
3. **RF-18.3**: o `EventsModule` continua importado do mesmo jeito, sem alterações no módulo nem nos seus providers.

## 10. Fluxo esperado de uma requisição

```
Requisição HTTP → checkout-service (3003)
   │
   ▼
JwtAuthGuard (global)
   │
   ├── Rota ou controller com isPublic? ── SIM ──► Controller (ex.: GET /health)
   │
   NÃO
   │
   ▼
JwtStrategy
   │
   ├── Header ausente / sem Bearer / token malformado ──► 401
   ├── Assinatura inválida ou payload adulterado ──────► 401
   ├── Token expirado ─────────────────────────────────► 401
   │
   VÁLIDO
   │
   ▼
req.user = { id, email, role } → Controller
```

## 11. Estrutura de pastas esperada (alto nível)

```
checkout-service/
├── docs/specs/02-entidades-e-validacao-de-jwt.md
├── .env                        → JWT_SECRET preenchido
├── src/
│   ├── auth/
│   │   ├── auth.module
│   │   ├── strategies/         → JwtStrategy
│   │   ├── guards/             → JwtAuthGuard
│   │   ├── decorators/         → @Public() e chave isPublic
│   │   ├── interfaces/         → payload do token e usuário autenticado
│   │   └── enums/              → roles (seller, buyer)
│   ├── cart/
│   │   ├── cart.module
│   │   ├── entities/           → Cart e CartItem
│   │   └── enums/              → CartStatus
│   ├── orders/
│   │   ├── orders.module
│   │   ├── entities/           → Order e OrderItem
│   │   ├── enums/              → OrderStatus
│   │   └── mappers/            → Order → mensagem de pagamento (seção 16)
│   ├── health/                 → HealthModule e HealthController
│   ├── events/                 → só os ajustes do contrato da seção 16
│   ├── config/database.config  → glob de entidades corrigido
│   ├── app.module              → registra os novos módulos
│   └── main                    → Swagger e fallback da porta 3003
└── test/
    ├── app.e2e-spec            → GET / sem token → 401
    └── e2e da proteção de rotas e do health
```

## 12. Variáveis de ambiente

Nenhuma variável nova. Só o valor abaixo precisa ser preenchido:

| Variável     | Descrição                                   | Valor em desenvolvimento                       |
| ------------ | ------------------------------------------- | ---------------------------------------------- |
| `JWT_SECRET` | Secret para validar a assinatura dos tokens | **O mesmo valor** do `.env` do users-service   |

## 13. Critérios de aceite

### Dependências e configuração

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-01 | `@nestjs/swagger` e `@types/passport-jwt` estão no `package.json` nas mesmas versões do products-service, e `pnpm install` termina sem erros.     | Comparar os dois `package.json` e rodar a instalação.                           |
| CA-02 | O `.env` tem `JWT_SECRET` com o mesmo valor do users-service, e o `.env.example` mantém a chave sem valor.                                       | Ler os arquivos.                                                                |
| CA-03 | Com `JWT_SECRET` vazio ou ausente, a aplicação não sobe e mostra um erro sobre a variável.                                                       | Esvaziar a variável no `.env`, rodar `pnpm run start:dev` e depois restaurar.   |
| CA-04 | Nenhum valor de secret real aparece em `src/` ou `test/`.                                                                                        | Buscar o valor do secret nas pastas. Só secrets fictícios de teste podem aparecer. |

### Entidades e banco

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-05 | O glob de entidades encontra `.entity.ts` e `.entity.js`.                                                                                        | Revisão de `database.config.ts`.                                                |
| CA-06 | Com o `checkout-db` no ar e o banco vazio, `pnpm run start:dev` cria as tabelas `carts`, `cart_items` e `orders`.                                | `\dt` no `checkout_db` (via `docker exec` no container `checkout-db`).          |
| CA-07 | `carts` tem as colunas da RF-04 com os tipos, a obrigatoriedade e os padrões descritos (`status` = `active`, `total` = `0`).                     | `\d carts`.                                                                     |
| CA-08 | `cart_items` tem as colunas da RF-05, **uma única** coluna `cartId` e uma FK para `carts` com `ON DELETE CASCADE`. Não tem `updatedAt`.          | `\d cart_items`.                                                                |
| CA-09 | `orders` tem as colunas da RF-06 (`status` = `pending`, `paymentMethod` varchar(50)) e **nenhuma** FK.                                           | `\d orders`.                                                                    |
| CA-10 | Os tipos enum do PostgreSQL têm exatamente os valores `active/completed/abandoned` e `pending/paid/failed/cancelled`.                             | `\dT+` no `checkout_db`.                                                        |
| CA-11 | Apagar um registro de `carts` remove os `cart_items` dele.                                                                                       | Inserir um carrinho com um item via SQL, apagar o carrinho e consultar `cart_items`. |
| CA-12 | Colunas decimais lidas pelo repositório chegam como `number`, não como `string`.                                                                 | Teste unitário do transformer ou leitura manual de um registro inserido.        |
| CA-13 | `CartModule` registra `Cart` e `CartItem`, `OrdersModule` registra `Order`, e nenhum dos dois tem controller ou service.                         | Revisão de código.                                                              |

### Proteção global

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-14 | `GET /` e `POST /test/send-message` sem token retornam 401.                                                                                      | Requisições sem header `Authorization`.                                         |
| CA-15 | `POST /test/send-message` com token válido continua retornando sucesso e publicando no RabbitMQ.                                                 | Teste manual com RabbitMQ no ar (painel em `localhost:15672`).                  |
| CA-16 | O guard está registrado via `APP_GUARD`, e nenhum controller declara o guard.                                                                    | Revisão do `AuthModule` e dos controllers.                                      |
| CA-17 | Uma rota nova sem `@Public()` fica protegida automaticamente.                                                                                    | Teste e2e com um controller de teste.                                           |
| CA-18 | Não existe rota de autenticação: `POST /auth/login` e `POST /auth/register` retornam 404.                                                        | Requisições às rotas.                                                           |

### Validação do token

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-19 | Header sem `Bearer`, `Bearer` sem token, token malformado, token com outro secret, payload adulterado e token expirado retornam 401.             | Testes e2e, um por cenário.                                                     |
| CA-20 | Toda resposta 401 tem só `statusCode` e `message`, sem stack trace nem motivo técnico da biblioteca.                                             | Conferir o corpo nos testes e2e.                                                |
| CA-21 | Tokens válidos de `seller` e de `buyer` dão acesso a rotas protegidas.                                                                           | Teste e2e com os dois roles.                                                    |
| CA-22 | Com token válido, `req.user` contém exatamente `id`, `email` e `role`, com `id` igual ao `sub`, e sem `sub`, `iat`, `exp` ou campos extras.      | Teste e2e com um controller de teste que devolve `req.user`.                    |
| CA-23 | Um token obtido no login real do users-service (`POST http://localhost:3000/auth/login`) é aceito em `GET http://localhost:3003/`.               | Teste manual com os dois serviços no ar.                                        |

### `@Public()`, health e Swagger

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-24 | `@Public()` em um método libera só aquela rota, e em um controller libera todas as rotas da classe.                                              | Testes e2e com controllers de teste.                                            |
| CA-25 | `GET /health` sem token retorna 200 com o corpo exato `{ "status": "ok", "service": "checkout-service" }`.                                       | Requisição sem `Authorization`.                                                 |
| CA-26 | `GET /health` com um token inválido ou expirado também retorna 200.                                                                              | Teste e2e.                                                                      |
| CA-27 | `GET /health` responde 200 mesmo com o RabbitMQ parado (o serviço sobe, porque o `RabbitmqService` já trata a falha de conexão).                 | Parar o RabbitMQ e chamar a rota.                                               |
| CA-28 | `http://localhost:3003/api` abre sem token, mostra o título `Checkout Service`, o botão de autorização Bearer e a rota `GET /health` na tag `Health`. | Abrir no navegador.                                                          |
| CA-29 | Sem `PORT` no ambiente, o serviço sobe na porta 3003.                                                                                            | Remover `PORT` do `.env` temporariamente e iniciar.                             |

### Não regressão e qualidade

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-30 | Nenhum arquivo em `src/events/` foi alterado.                                                                                                    | `git diff --stat src/events` vazio.                                             |
| CA-31 | Existem testes unitários do guard (rota pública × protegida, prioridade método × controller), da strategy (mapeamento de `req.user`) e do `HealthController`. | `pnpm run test`.                                                        |
| CA-32 | O teste e2e de `GET /` espera 401 sem token.                                                                                                     | Ler `test/app.e2e-spec.ts`.                                                     |
| CA-33 | `pnpm run build`, `pnpm run lint` e `pnpm run test` terminam sem erros. `pnpm run test:e2e` passa com o `checkout-db` e o RabbitMQ no ar.         | Rodar os comandos.                                                              |
| CA-34 | Nenhum arquivo de outro serviço (users, products, payments, api-gateway) foi alterado.                                                           | `git status` nos outros repositórios.                                           |

## 14. Pontos de atenção

- **Glob de entidades:** sem a RF-07, as entidades existem no código, mas o TypeORM não as encontra em `dist/` e **nenhuma tabela é criada**, sem nenhum erro no log. Se CA-06 falhar, confira isso primeiro.
- **Duas propriedades na mesma coluna:** em `CartItem`, `cart` e `cartId` precisam apontar para a mesma coluna. Se a relação não for ligada explicitamente ao nome `cartId`, o TypeORM cria uma segunda coluna de FK e `cartId` fica solto.
- **Cascade x ON DELETE CASCADE:** o cascade da relação `items` (RF-04.2) trata a persistência pelo TypeORM. O `ON DELETE CASCADE` da FK (RF-05.2) trata a remoção no banco. As duas coisas são necessárias e independentes.
- **Eager em `Cart.items`:** funciona com os métodos do repositório (`find`, `findOne`). Em consultas com QueryBuilder, os itens precisam ser carregados explicitamente. Considerar isso nas próximas specs.
- **`Order.cartId` sem FK:** é intencional. O pedido guarda os próprios itens (`OrderItem`, seção 16), então a referência ao carrinho serve só para rastreio. Se o carrinho for apagado, o pedido e a mensagem de pagamento não são afetados.
- **Mudança de schema com `synchronize`:** em desenvolvimento, alterar uma entidade altera a tabela automaticamente e pode **apagar dados** de colunas renomeadas. Em produção o `synchronize` fica desligado e o schema vai precisar de migrations, o que fica fora desta spec.
- **Rota de teste protegida:** `POST /test/send-message` passa a exigir token. Requisições já salvas no Postman precisam do header `Authorization`.
- **Secret compartilhado:** se o `JWT_SECRET` divergir do users-service, toda rota protegida retorna 401 sem outro sinal de erro.
- **Enum de roles duplicado:** o enum agora existe em quatro lugares (users, products, api-gateway e checkout). Um role novo no users-service exige atualizar todos.
- **Porta do banco:** o pedido citava 5436, mas o checkout usa **5435** desde a spec 01. A 5436 é do products-service, e esta spec não muda isso.
- **E2e e infraestrutura:** o e2e que sobe o `AppModule` inteiro precisa do PostgreSQL e do RabbitMQ. Os e2e de auth e health devem montar só o necessário (guard, strategy, controllers de teste e `HealthController`), como no products-service, para não depender deles.

## 15. Commits

Esta aula termina com **um único commit** no repositório do checkout-service.

- O commit inclui esta spec e toda a implementação: dependências, entidades, módulos, auth, health, Swagger, ajuste do glob, ajuste do e2e e testes novos.
- O `.env` é ignorado pelo git. O valor do `JWT_SECRET` deve ser preenchido localmente antes de validar, mas não entra no commit.
- Antes do commit, rodar `pnpm run lint`, `pnpm run build` e `pnpm run test` e garantir que tudo passa.
- A mensagem segue o padrão do histórico, em português. Sugestão: `feat: cria entidades de carrinho e pedido e valida JWT no checkout-service`.

## 16. Ajustes após a implementação: contrato da mensagem de pagamento

A validação da mensagem `PaymentOrderMessage` contra as entidades mostrou quatro problemas. Os ajustes abaixo foram aprovados depois da implementação e liberam, **só para eles**, alterações em `src/events/`.

| #  | Problema                                                                                                    | Ajuste                                                                                                                                       |
| -- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 | O payments-service rejeita mensagem sem `paymentMethod`, mas o `publishPaymentOrderSafe` do checkout não validava o campo. | O `publishPaymentOrderSafe` passa a rejeitar `paymentMethod` vazio.                                                                           |
| P2 | O `Order` não guardava itens: a mensagem dependia do carrinho, que pode mudar ou ser apagado depois do pedido. | Nova entidade `OrderItem` (RF-06A), com cópia dos itens no fechamento. Os itens da mensagem vêm do pedido.                                    |
| P3 | Nenhum serviço garantia que `amount` é igual à soma dos itens.                                              | O `publishPaymentOrderSafe` rejeita item sem `productId`, com `quantity` não inteira ou ≤ 0, `price` ≤ 0 e `amount` diferente de Σ price × quantity (em centavos). |
| P4 | `createdAt` era tipado como `Date`, mas trafega no JSON como texto.                                         | `createdAt` passa a ser `string` em ISO 8601 no checkout e no payments-service.                                                               |

Outras mudanças desta seção:

- Função `toPaymentOrderMessage` em `src/orders/mappers/`, que monta a mensagem só a partir do `Order` (com itens). A spec de checkout deve usá-la.
- A mensagem de teste do `POST /test/send-message` passa a usar `amount` 199.98 (2 × 99.99) e `createdAt` em ISO 8601.

### Critérios de aceite

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-35 | `order_items` existe, tem uma única coluna `orderId` e FK para `orders` com `ON DELETE CASCADE`; apagar um pedido apaga os itens dele.            | `\d order_items` e e2e `payment-order-message`.                                  |
| CA-36 | A mensagem publicada tem exatamente `orderId`, `userId`, `amount`, `items` (`productId`, `quantity`, `price`), `paymentMethod`, `createdAt` e `metadata`, com `amount` e `price` numéricos. | e2e `payment-order-message`.                                                     |
| CA-37 | Alterar o carrinho depois do pedido não muda os itens da mensagem.                                                                               | e2e `payment-order-message`.                                                     |
| CA-38 | `publishPaymentOrderSafe` rejeita, sem publicar, cada um dos casos de P1 e P3.                                                                   | Testes unitários do `PaymentQueueService`.                                       |
| CA-39 | `createdAt` é `string` ISO 8601 na interface dos dois serviços e na mensagem publicada.                                                         | Revisão das interfaces e testes.                                                 |
