# SPEC: Correção de portas e configuração de banco (checkout-service e payments-service)

| Campo        | Valor                                                                 |
| ------------ | --------------------------------------------------------------------- |
| Serviços     | checkout-service e payments-service                                   |
| Sistema      | marketplace-ms                                                        |
| Tipo         | Infraestrutura / configuração / testes                                |
| Status       | Pronta para planejamento                                              |
| Data         | 2026-10-14                                                            |
| Depende de   | —                                                                     |

---

## 1. Objetivo

Garantir que os quatro bancos PostgreSQL do marketplace-ms rodem **ao mesmo tempo**, cada um em uma porta própria, e que a porta configurada em cada serviço seja a **mesma** em `docker-compose.yaml`, `.env` e no fallback do `database.config.ts`.

Também garante que o `.env` de cada serviço seja **realmente lido** na conexão com o banco, para que uma divergência futura não fique escondida pelo fallback.

## 2. Ponto de partida

### 2.1 Diagnóstico inicial x código atual

O pedido original partiu de um diagnóstico que **não corresponde mais ao código**. A tabela abaixo registra cada ponto e a decisão desta spec:

| #  | Diagnóstico inicial                                                                 | Estado real no código                                                                                                         | Decisão                                                                                                   |
| -- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D1 | checkout-service e products-service usam a porta **5434**.                          | checkout-service usa **5435** (compose e fallback); products-service usa **5436** (compose, `.env` e fallback).               | **Não** mover o checkout para 5436: essa porta já é do products-service, e ele não pode ser alterado.      |
| D2 | `.env` do payments-service tem `DB_PORT=5434`, mas o compose expõe **5435**.        | O compose do payments-service expõe **5434**. `.env` (5434), compose (5434) e fallback (5434) já estão alinhados.             | **Não** mudar o `.env` para 5435: quebraria a conexão e colidiria com o checkout-service.                  |
| D3 | `app.controller.spec.ts` do checkout-service não provê `PaymentQueueService`.       | O teste já registra um mock de `PaymentQueueService` (`useValue: { publishPaymentOrder: jest.fn() }`) e **passa** (1/1).      | Nenhuma alteração; apenas verificar (RF-05).                                                              |

### 2.2 Mapa de portas atual (lado host)

| Serviço          | Porta da API | `docker-compose.yaml` | `.env` (`DB_PORT`) | Fallback em `database.config.ts` | Situação           |
| ---------------- | ------------ | --------------------- | ------------------ | -------------------------------- | ------------------ |
| users-service    | 3000         | 5433                  | 5433               | 5433                             | OK (fora do escopo)|
| products-service | 3001         | 5436                  | 5436               | 5436                             | OK (fora do escopo)|
| checkout-service | 3003         | 5435                  | **5432**           | 5435                             | **Divergente**     |
| payments-service | 3004         | 5434                  | 5434               | 5434                             | OK                 |

Não há colisão de portas entre os composes: 5433, 5434, 5435 e 5436 são distintas.

### 2.3 Lacunas reais identificadas

| #  | Lacuna                                                                                                                                                                                                                                                                         | Tratada em |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| L1 | checkout-service: `.env` tem `DB_PORT=5432`, mas o compose expõe **5435**.                                                                                                                                                                                                    | RF-01      |
| L2 | checkout-service: `databaseConfig` é um **objeto** avaliado no `import`, antes de o `ConfigModule.forRoot()` carregar o `.env`. Por isso o `DB_PORT=5432` é ignorado e o serviço só conecta porque cai no fallback 5435. Corrigir só o L2 sem o L1 quebraria a conexão.          | RF-02      |
| L3 | payments-service: não chama `ConfigModule.forRoot()` (o `EventsModule` só importa `ConfigModule` puro). O `.env` **nunca é carregado**; todas as variáveis (banco, RabbitMQ) vêm do ambiente do shell ou dos fallbacks.                                                         | RF-03      |
| L4 | payments-service: mesmo problema do L2 (`databaseConfig` como objeto e `TypeOrmModule.forRoot`).                                                                                                                                                                              | RF-03      |
| L5 | payments-service: o `.env` começa com o comentário `#checkout-service/.env` (copiado do checkout).                                                                                                                                                                              | RF-04      |

O users-service e o products-service já usam o padrão correto e servem de **modelo**: `databaseConfig` como factory e `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })`, com o comentário "factory: só lê o process.env depois que o ConfigModule carregou o .env".

## 3. Escopo

### Dentro do escopo

**checkout-service**
- Alinhar `DB_PORT` do `.env` com o compose (5435).
- Converter `databaseConfig` em factory e usar `TypeOrmModule.forRootAsync`.
- Verificar o teste `app.controller.spec.ts`.

**payments-service**
- Registrar `ConfigModule.forRoot({ isGlobal: true })` no `AppModule`.
- Converter `databaseConfig` em factory e usar `TypeOrmModule.forRootAsync`.
- Corrigir o comentário de cabeçalho do `.env`.

### Fora do escopo

- **Qualquer** alteração no users-service ou no products-service.
- Trocar a porta do banco de qualquer serviço (nenhuma colisão existe hoje).
- `docker-compose` raiz, Dockerfiles ou containerização das APIs.
- Alterações no `messaging-service` (RabbitMQ) e na lógica de filas (`PaymentQueueService`, `RabbitmqService`).
- Correção do glob de entidades (`*.entity{.ts,js}` sem o ponto em `js`) no checkout e no payments — registrado na seção 7.

---

## 4. Requisitos funcionais: checkout-service

### RF-01: Porta do banco alinhada

1. **RF-01.1** — `.env`: `DB_PORT` passa de `5432` para **`5435`**.
2. **RF-01.2** — `docker-compose.yaml` continua com `"5435:5432"` (sem alteração).
3. **RF-01.3** — `src/config/database.config.ts` continua com fallback **`5435`** (sem alteração de valor).
4. **RF-01.4** — `.env.example` não recebe valores (continua só com as chaves), para não versionar configuração.

### RF-02: Leitura do `.env` na conexão com o banco

1. **RF-02.1** — `databaseConfig` passa a ser uma **função** que retorna `TypeOrmModuleOptions`, como no users-service, com o mesmo comentário explicando o motivo.
2. **RF-02.2** — `AppModule` troca `TypeOrmModule.forRoot(databaseConfig)` por `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })`.
3. **RF-02.3** — `ConfigModule.forRoot({ isGlobal: true })` continua sendo o **primeiro** import do `AppModule`.
4. **RF-02.4** — Os valores de fallback e os demais campos (`entities`, `synchronize`, `logging`) não mudam.
5. **RF-02.5** — RF-01 deve estar aplicado **antes** do RF-02; caso contrário, o serviço passa a ler `5432` e não conecta.

## 5. Requisitos funcionais: payments-service

### RF-03: Carregamento do `.env` e leitura na conexão

1. **RF-03.1** — `AppModule` passa a importar `ConfigModule.forRoot({ isGlobal: true })` como **primeiro** import, igual ao checkout-service.
2. **RF-03.2** — `databaseConfig` passa a ser uma função (mesmo padrão do RF-02.1).
3. **RF-03.3** — `AppModule` usa `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })`.
4. **RF-03.4** — `.env`, `docker-compose.yaml` e fallback continuam em **5434**. Nenhum valor de porta muda.
5. **RF-03.5** — O `EventsModule` e o `RabbitmqService` não são alterados; com o `ConfigModule` global, o `ConfigService` passa a enxergar as variáveis do `.env`.
6. **RF-03.6** — A dependência `@nestjs/config` já existe no `package.json`; nenhuma dependência nova é adicionada.

### RF-04: Higiene do `.env`

1. **RF-04.1** — O comentário da primeira linha do `.env` passa de `#checkout-service/.env` para `#payments-service/.env`.
2. **RF-04.2** — Nenhum outro valor do `.env` é alterado.

## 6. Requisitos de teste

### RF-05: Teste do `AppController` do checkout-service

1. **RF-05.1** — `src/app.controller.spec.ts` mantém no `TestingModule` o `AppService` real e o mock de `PaymentQueueService`:
   ```ts
   {
     provide: PaymentQueueService,
     useValue: { publishPaymentOrder: jest.fn() },
   }
   ```
2. **RF-05.2** — O teste não depende de RabbitMQ nem de PostgreSQL em execução.
3. **RF-05.3** — Como o mock já existe e o teste passa, **nenhuma alteração** é necessária. Se o arquivo tiver sido revertido no momento da implementação, o mock acima deve ser (re)adicionado.

---

## 7. Pontos de atenção

- **Por que o checkout funcionava com `DB_PORT=5432`:** o objeto `databaseConfig` é avaliado no `import` do `AppModule`, antes de o `ConfigModule` popular o `process.env`. O `DB_PORT` do `.env` era `undefined` nesse momento e o fallback `5435` era usado. Isso mascarava o erro do `.env`.
- **Variáveis exportadas no shell:** o `ConfigModule` não sobrescreve variáveis que já existem no `process.env`. Se `DB_PORT` estiver definido no terminal, ele vence o `.env`. Considerar isso ao validar os critérios de aceite.
- **Glob de entidades:** checkout e payments usam `*.entity{.ts,js}` (falta o ponto antes de `js`), enquanto users e products usam `{.ts,.js}`. Em build (`dist/`), entidades `.js` podem não ser encontradas. Fica para uma spec futura.
- **`.env` do payments com nome de serviço errado** era só um comentário, mas indica cópia do checkout; revisar se outros valores também foram copiados por engano (ex.: `JWT_SECRET` vazio nos dois).
- **Portas reservadas no host:** 5432 (Postgres local, se houver), 5433 a 5436 (bancos dos serviços), 5672 e 15672 (RabbitMQ). Novos serviços devem usar portas a partir de 5437.

## 8. Critérios de aceite

### checkout-service

| #     | Critério                                                                                                                                                           | Como verificar                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| CA-01 | `.env` contém `DB_PORT=5435`; `docker-compose.yaml` expõe `"5435:5432"`; fallback em `database.config.ts` é `5435`.                                                 | Revisão dos três arquivos.                                                  |
| CA-02 | `database.config.ts` exporta uma função e o `AppModule` usa `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })`.                                          | Revisão do código.                                                          |
| CA-03 | Com o `checkout-db` no ar, `pnpm run start:dev` conecta ao banco sem erro de conexão do TypeORM.                                                                    | Logs de inicialização.                                                      |
| CA-04 | O `.env` é efetivamente lido: com `DB_PORT=5499` temporário no `.env`, o serviço **falha** ao conectar; ao voltar para `5435`, conecta.                             | Teste manual (reverter o `.env` ao final).                                  |
| CA-05 | `pnpm exec jest src/app.controller.spec.ts` passa (1/1), sem RabbitMQ e sem PostgreSQL no ar.                                                                       | Rodar o comando com os containers parados.                                  |

### payments-service

| #     | Critério                                                                                                                                                           | Como verificar                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| CA-06 | `.env`, `docker-compose.yaml` e fallback continuam em `5434`; a primeira linha do `.env` é `#payments-service/.env`.                                                | Revisão dos arquivos.                                                       |
| CA-07 | `AppModule` importa `ConfigModule.forRoot({ isGlobal: true })` antes do `TypeOrmModule.forRootAsync({ useFactory: databaseConfig })`.                               | Revisão do código.                                                          |
| CA-08 | Com o `payments-db` no ar, `pnpm run start:dev` conecta ao banco sem erro.                                                                                          | Logs de inicialização.                                                      |
| CA-09 | O `.env` é efetivamente lido: com `DB_PORT=5499` temporário no `.env`, o serviço **falha** ao conectar; ao voltar para `5434`, conecta.                             | Teste manual (reverter o `.env` ao final).                                  |

### Integração

| #     | Critério                                                                                                                                                           | Como verificar                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| CA-10 | Os quatro composes (`users`, `products`, `checkout`, `payments`) sobem **ao mesmo tempo** sem erro de porta em uso.                                                 | `docker compose up -d` em cada pasta; `docker ps` mostra 4 bancos com 5433 a 5436. |
| CA-11 | Com os quatro bancos no ar, checkout-service (3003) e payments-service (3004) iniciam juntos e conectam cada um ao seu banco.                                        | Logs de inicialização.                                                      |
| CA-12 | Nenhum arquivo do users-service ou do products-service foi alterado.                                                                                                | `git status` / `git diff` nos dois repositórios.                            |
| CA-13 | `pnpm run build`, `pnpm run lint` e `pnpm run test` passam sem erros no checkout-service e no payments-service.                                                     | Rodar os comandos.                                                          |

## 9. Commits

Faça sempre um commit após cada implementação desta spec.

- checkout-service e payments-service são **repositórios git distintos**: cada commit vai no repositório do serviço alterado.
- O `.env` é ignorado pelo git; as mudanças nele não geram commit, mas devem ser aplicadas antes dos commits de código.
- Sugestão de commits:
  1. checkout-service: `fix(config): carrega o databaseConfig depois do ConfigModule` (RF-02).
  2. checkout-service: `docs: spec de correção de portas e configuração de banco` (este arquivo).
  3. payments-service: `fix(config): registra ConfigModule global e databaseConfig como factory` (RF-03).
- Antes de cada commit, rodar o lint do serviço alterado e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico de cada repositório, em português e descrevendo a etapa de forma objetiva.
