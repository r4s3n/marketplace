# SPEC: Scaffold do users-service

| Campo        | Valor                                   |
| ------------ | --------------------------------------- |
| Serviço      | users-service                           |
| Sistema      | marketplace-ms                          |
| Tipo         | Scaffold / infraestrutura base          |
| Status       | Pronta para planejamento                |
| Data         | 2026-10-10                              |

---

## 1. Objetivo

Preparar a base do **users-service**, o microserviço responsável por gerenciar os usuários do marketplace. Ao final desta spec, o serviço deve subir na porta **3000**, conectar a um PostgreSQL próprio e ter a tabela de usuários criada. Nenhum comportamento de negócio é exposto ainda.

O projeto NestJS já foi gerado com o Nest CLI (gerenciador **pnpm**). Esta spec cobre o que falta a partir desse ponto.

## 2. Contexto no sistema

| Serviço            | Porta app | Banco (porta host) | Database      |
| ------------------ | --------- | ------------------ | ------------- |
| **users-service**  | **3000**  | **5433**           | **users_db**  |
| checkout-service   | 3003      | 5435               | checkout_db   |
| payments-service   | 3004      | 5434               | payments_db   |
| api-gateway        | 3005      | —                  | —             |
| messaging-service  | —         | RabbitMQ 5672 / 15672 | —          |

- O api-gateway e o checkout-service já esperam o users-service em `http://localhost:3000` (`USERS_SERVICE_URL`).
- Cada serviço tem o seu próprio banco (database-per-service). O users-service não acessa o banco de outro serviço, e nenhum outro serviço acessa o `users_db`.

## 3. Padrões a seguir (herdados dos outros serviços)

O users-service deve ficar consistente com o checkout-service e o payments-service:

- Gerenciador de pacotes **pnpm**, NestJS 11, mesma configuração de TypeScript (sem modo strict), ESLint e Prettier do CLI.
- Configuração do banco isolada em um arquivo próprio dentro de `src/config/`, lendo as variáveis de ambiente e com valores padrão para desenvolvimento local.
- Entidades descobertas automaticamente pelo padrão de arquivo `*.entity`.
- Sincronização automática do schema ativa **apenas fora de produção**; log de SQL ativo **apenas em desenvolvimento**.
- `ConfigModule` global.
- CORS habilitado.
- `docker-compose.yaml` na raiz do serviço, com container, volume e rede nomeados com o prefixo do serviço.
- `.env` (ignorado pelo git) e `.env.example` (versionado, só com as chaves, sem valores).
- Mensagem de inicialização no console com emoji e a porta, no mesmo estilo dos outros serviços.

## 4. Requisitos funcionais

### RF-01: Dependências do projeto
O projeto deve declarar as dependências de runtime necessárias para:
- integração do NestJS com o TypeORM (`@nestjs/typeorm`, `typeorm`);
- driver do PostgreSQL (`pg`);
- leitura de variáveis de ambiente (`@nestjs/config`);
- validação e transformação de dados de entrada (`class-validator`, `class-transformer`).

Nenhuma outra dependência deve ser adicionada nesta etapa (sem JWT, bcrypt, Swagger, RabbitMQ etc.).

### RF-02: Banco de dados via Docker Compose
- Deve existir um `docker-compose.yaml` na raiz do users-service.
- Ele deve subir **um único** container com a imagem **PostgreSQL 15**.
- Nome do container: `users-db`.
- O banco deve ficar exposto no host na porta **5433**, mapeada para a porta 5432 do container.
- O database criado automaticamente deve ser `users_db`.
- Usuário e senha do banco iguais aos dos outros serviços em desenvolvimento.
- Os dados devem persistir em um volume nomeado (`users_db_data`), para sobreviver a reinícios do container.
- O container deve ficar numa rede própria do serviço (`users-network`).

### RF-03: Conexão com o banco via variáveis de ambiente
- A aplicação deve se conectar ao PostgreSQL usando **apenas** as variáveis da seção 6, sem credenciais escritas direto no código-fonte além dos valores padrão de desenvolvimento.
- Se a conexão falhar, a aplicação não deve iniciar e o erro deve aparecer no console.
- Em ambiente diferente de produção, o schema deve ser sincronizado automaticamente a partir das entidades (sem migrations nesta etapa).

### RF-04: Porta da aplicação
- A aplicação deve escutar na porta definida em `PORT`.
- Se `PORT` não estiver definida, deve usar **3000** como padrão.
- Ao iniciar, deve registrar no console uma mensagem dizendo que o Users Service está rodando e em qual porta.

### RF-05: Módulo de usuários
- Deve existir um módulo `users` dedicado ao domínio de usuários, registrado no módulo raiz da aplicação.
- O módulo deve registrar a entidade `User` no TypeORM, deixando o repositório dela disponível para uso futuro.
- O módulo **não** deve expor rotas HTTP nesta etapa. Pode existir um service vazio como placeholder.
- A entidade e os enums devem ficar dentro da pasta do módulo `users`.

### RF-06: ValidationPipe global
Um pipe de validação global deve ficar ativo para todas as requisições, com o mesmo comportamento dos outros serviços:
- remover propriedades que não estão declaradas no DTO;
- rejeitar a requisição quando chegarem propriedades não declaradas;
- transformar o payload recebido para os tipos declarados no DTO.

### RF-07: Arquivos de ambiente
- `.env.example` versionado, contendo **apenas as chaves** da seção 6, sem valores.
- `.env` local com os valores de desenvolvimento, **não versionado** (ignorado pelo `.gitignore`).

## 5. Estrutura de dados

### 5.1 Entidade `User`

Tabela: `users`

| Campo       | Tipo      | Obrigatório | Único | Default     | Regras / observações                                    |
| ----------- | --------- | ----------- | ----- | ----------- | ------------------------------------------------------- |
| `id`        | UUID      | sim         | sim   | gerado      | Chave primária, gerada automaticamente pelo banco/ORM.  |
| `email`     | string    | sim         | sim   | —           | Não pode existir dois usuários com o mesmo e-mail.      |
| `password`  | string    | sim         | não   | —           | Guarda **somente o hash** da senha, nunca o texto puro. |
| `firstName` | string    | sim         | não   | —           | Primeiro nome.                                          |
| `lastName`  | string    | sim         | não   | —           | Sobrenome.                                              |
| `role`      | enum      | sim         | não   | —           | Valores aceitos: `seller`, `buyer`.                     |
| `status`    | enum      | sim         | não   | `active`    | Valores aceitos: `active`, `inactive`.                  |
| `createdAt` | timestamp | sim         | não   | automático  | Preenchido automaticamente na criação do registro.      |
| `updatedAt` | timestamp | sim         | não   | automático  | Atualizado automaticamente a cada alteração.            |

A entidade deve ter **apenas** esses campos.

### 5.2 Enums

**UserRole**

| Valor    | Significado                         |
| -------- | ----------------------------------- |
| `seller` | Usuário que vende no marketplace.   |
| `buyer`  | Usuário que compra no marketplace.  |

**UserStatus**

| Valor      | Significado                              |
| ---------- | ---------------------------------------- |
| `active`   | Conta ativa (valor padrão na criação).   |
| `inactive` | Conta desativada.                        |

Os dois enums devem existir como tipos de enum do PostgreSQL, para que o próprio banco rejeite valores fora da lista.

### 5.3 Estrutura de pastas esperada (alto nível)

```
users-service/
├── docs/specs/scaffold.md
├── docker-compose.yaml
├── .env / .env.example
└── src/
    ├── config/          → configuração do banco
    ├── users/           → módulo de usuários
    │   ├── entities/    → entidade User
    │   └── enums/       → UserRole e UserStatus
    ├── app.module
    └── main
```

## 6. Variáveis de ambiente

| Variável      | Descrição                         | Valor em desenvolvimento |
| ------------- | --------------------------------- | ------------------------ |
| `PORT`        | Porta HTTP do users-service       | `3000`                   |
| `DB_HOST`     | Host do PostgreSQL                | `localhost`              |
| `DB_PORT`     | Porta do PostgreSQL no host       | `5433`                   |
| `DB_USERNAME` | Usuário do banco                  | `postgres`               |
| `DB_PASSWORD` | Senha do banco                    | `postgres`               |
| `DB_DATABASE` | Nome do database                  | `users_db`               |

> Os outros serviços também usam `NODE_ENV` para ligar ou desligar a sincronização do schema e o log de SQL. Para manter o mesmo comportamento, `NODE_ENV=development` pode ser incluída no `.env` e no `.env.example`.

## 7. Fora do escopo

Fica para specs futuras:
- Endpoints HTTP (cadastro, login, listagem, atualização, sessão etc.).
- Autenticação, JWT, sessões e hash de senha (bcrypt).
- DTOs de entrada e saída.
- Regras de negócio (troca de role, desativação de conta etc.).
- Migrations, seeds e dados iniciais.
- Integração com RabbitMQ, Swagger, health check.
- Testes além dos que o CLI já gera.

## 8. Critérios de aceite

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-01 | Com `docker compose up -d` na pasta do serviço, sobe um container `users-db` rodando PostgreSQL 15.                                              | `docker ps` mostra `users-db` com a imagem `postgres:15`.                       |
| CA-02 | O banco aceita conexões na porta **5433** do host e o database `users_db` existe.                                                                 | Conectar em `localhost:5433` com as credenciais do `.env` e listar os databases. |
| CA-03 | `pnpm install` termina sem erros e o `package.json` contém `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator` e `class-transformer`. | Ler o `package.json` e rodar a instalação.                                      |
| CA-04 | Com o banco no ar, `pnpm run start:dev` inicia a aplicação sem erros e mostra no console a mensagem de inicialização com a porta 3000.            | Observar o console.                                                             |
| CA-05 | Sem `PORT` definida, a aplicação sobe na porta 3000.                                                                                             | Remover `PORT` do `.env`, iniciar e conferir a porta.                           |
| CA-06 | Mudar os valores de conexão no `.env` muda o banco usado, sem alterar código.                                                                    | Apontar `DB_PORT` para uma porta errada: a aplicação deve falhar ao conectar.   |
| CA-07 | Depois de iniciar a aplicação, existe a tabela `users` no `users_db` com **exatamente** as 9 colunas da seção 5.1.                               | Inspecionar a tabela no banco.                                                  |
| CA-08 | A coluna `id` é UUID e é gerada automaticamente ao inserir um registro sem `id`.                                                                 | Inserir um registro sem `id` direto no banco e conferir o valor gerado.         |
| CA-09 | Inserir dois usuários com o mesmo `email` falha por violação de unicidade.                                                                       | Inserção manual duplicada no banco.                                             |
| CA-10 | `role` aceita só `seller` ou `buyer`; qualquer outro valor é rejeitado pelo banco.                                                                | Tentar inserir `role = 'admin'`.                                                |
| CA-11 | `status` aceita só `active` ou `inactive`; quando não é informado, o registro fica com `active`.                                                  | Inserir sem `status` e conferir; tentar inserir `status = 'blocked'`.           |
| CA-12 | `createdAt` e `updatedAt` são preenchidos automaticamente na inserção, e `updatedAt` muda quando o registro é alterado.                          | Inserir, atualizar e comparar os timestamps.                                    |
| CA-13 | O módulo `users` existe, está registrado no módulo raiz e **não** expõe rotas.                                                                    | Os logs de inicialização não listam rotas do módulo `users`.                    |
| CA-14 | O ValidationPipe global está ativo com whitelist, rejeição de propriedades extras e transformação.                                               | Revisão do bootstrap da aplicação.                                              |
| CA-15 | Existe `.env.example` com as 6 variáveis da seção 6 sem valores, e o `.env` não é versionado.                                                     | Ler o `.env.example`; `git status` não mostra o `.env`.                         |
| CA-16 | `pnpm run build` e `pnpm run lint` terminam sem erros.                                                                                           | Rodar os comandos.                                                              |

## 9. Pontos de atenção para as próximas specs

- **Divergência de roles com o api-gateway:** o `RegisterDto` do api-gateway usa as roles `user`, `admin` e `seller`, com `user` como padrão. Esta spec define `seller` e `buyer`. Isso precisa ser alinhado antes de implementar o cadastro, ajustando o gateway ou o users-service.
- **Rotas que o gateway já espera:** o api-gateway já chama `POST /auth/register`, `POST /login` e `GET /session/validate/:token` no users-service. Essas rotas devem ser cobertas em specs futuras.


## 10. Commits

faça sempre um commit após cada implementação dessa spec
