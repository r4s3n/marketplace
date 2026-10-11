# SPEC: Scaffold do products-service

| Campo        | Valor                                   |
| ------------ | --------------------------------------- |
| Serviço      | products-service                        |
| Sistema      | marketplace-ms                          |
| Tipo         | Scaffold / infraestrutura base          |
| Status       | Pronta para planejamento                |
| Data         | 2026-10-11                              |

---

## 1. Objetivo

Preparar a base do **products-service**, o microserviço responsável pelo catálogo de produtos do marketplace. Ao final desta spec, o serviço deve subir na porta **3001**, conectar a um PostgreSQL próprio e ter a tabela de produtos criada. Nenhum comportamento de negócio é exposto ainda.

O projeto NestJS já foi gerado com o Nest CLI (gerenciador **pnpm**). Esta spec cobre o que falta a partir desse ponto.

## 2. Contexto no sistema

| Serviço              | Porta app | Banco (porta host)    | Database        |
| -------------------- | --------- | --------------------- | --------------- |
| users-service        | 3000      | 5433                  | users_db        |
| **products-service** | **3001**  | **5436**              | **products_db** |
| checkout-service     | 3003      | 5435                  | checkout_db     |
| payments-service     | 3004      | 5434                  | payments_db     |
| api-gateway          | 3005      | —                     | —               |
| messaging-service    | —         | RabbitMQ 5672 / 15672 | —               |

- O api-gateway já espera o products-service em `http://localhost:3001` (`PRODUCTS_SERVICE_URL`). O checkout-service e o payments-service também já declaram essa variável.
- Cada serviço tem o seu próprio banco (database-per-service). O products-service não acessa o banco de outro serviço, e nenhum outro serviço acessa o `products_db`.
- O vendedor de um produto é um usuário do users-service. O products-service guarda apenas o identificador desse usuário, sem chave estrangeira, porque os bancos são separados.

## 3. Padrões a seguir (herdados dos outros serviços)

O products-service deve ficar consistente com o users-service:

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

As versões devem ser as mesmas usadas no users-service. Nenhuma outra dependência deve ser adicionada nesta etapa (sem JWT, Swagger, RabbitMQ, cliente HTTP etc.).

### RF-02: Banco de dados via Docker Compose
- Deve existir um `docker-compose.yaml` na raiz do products-service.
- Ele deve subir **um único** container com a imagem **PostgreSQL 15**.
- Nome do container: `products-db`.
- O banco deve ficar exposto no host na porta **5436**, mapeada para a porta 5432 do container (ver seção 9 sobre a porta).
- O database criado automaticamente deve ser `products_db`.
- Usuário e senha do banco iguais aos dos outros serviços em desenvolvimento.
- Os dados devem persistir em um volume nomeado (`products_db_data`), para sobreviver a reinícios do container.
- O container deve ficar numa rede própria do serviço (`products-network`).
- O banco do products-service deve poder rodar ao mesmo tempo que os bancos dos outros serviços, sem conflito de porta ou de nome de container.

### RF-03: Conexão com o banco via variáveis de ambiente
- A aplicação deve se conectar ao PostgreSQL usando **apenas** as variáveis da seção 6, sem credenciais escritas direto no código-fonte além dos valores padrão de desenvolvimento.
- Se a conexão falhar, a aplicação não deve iniciar e o erro deve aparecer no console.
- Em ambiente diferente de produção, o schema deve ser sincronizado automaticamente a partir das entidades (sem migrations nesta etapa).

### RF-04: Porta da aplicação
- A aplicação deve escutar na porta definida em `PORT`.
- Se `PORT` não estiver definida, deve usar **3001** como padrão.
- Ao iniciar, deve registrar no console uma mensagem dizendo que o Products Service está rodando e em qual porta.

### RF-05: Módulo de produtos
- Deve existir um módulo `products` dedicado ao catálogo, registrado no módulo raiz da aplicação.
- O módulo deve registrar a entidade `Product` no TypeORM, deixando o repositório dela disponível para uso futuro.
- O módulo **não** deve expor rotas HTTP nesta etapa. Pode existir um service vazio como placeholder.
- A entidade deve ficar dentro da pasta do módulo `products`.

### RF-06: ValidationPipe global
Um pipe de validação global deve ficar ativo para todas as requisições, com o mesmo comportamento dos outros serviços:
- remover propriedades que não estão declaradas no DTO;
- rejeitar a requisição quando chegarem propriedades não declaradas;
- transformar o payload recebido para os tipos declarados no DTO.

### RF-07: Arquivos de ambiente
- `.env.example` versionado, contendo **apenas as chaves** da seção 6, sem valores.
- `.env` local com os valores de desenvolvimento, **não versionado** (ignorado pelo `.gitignore`).

## 5. Estrutura de dados

### 5.1 Entidade `Product`

Tabela: `products`

| Campo         | Tipo           | Obrigatório | Default    | Regras / observações                                                              |
| ------------- | -------------- | ----------- | ---------- | --------------------------------------------------------------------------------- |
| `id`          | UUID           | sim         | gerado     | Chave primária, gerada automaticamente pelo banco/ORM.                            |
| `name`        | string (255)   | sim         | —          | Nome do produto, até 255 caracteres.                                              |
| `description` | text           | sim         | —          | Descrição do produto, sem limite de tamanho.                                      |
| `price`       | decimal (10,2) | sim         | —          | Preço com 2 casas decimais e até 10 dígitos no total (máximo 99.999.999,99).      |
| `stock`       | int            | sim         | `0`        | Quantidade em estoque.                                                            |
| `sellerId`    | UUID           | sim         | —          | ID do usuário vendedor no users-service. **Sem** chave estrangeira (banco separado). |
| `isActive`    | boolean        | sim         | `true`     | Indica se o produto está disponível no catálogo.                                  |
| `createdAt`   | timestamp      | sim         | automático | Preenchido automaticamente na criação do registro.                                |
| `updatedAt`   | timestamp      | sim         | automático | Atualizado automaticamente a cada alteração.                                      |

A entidade deve ter **apenas** esses campos. Nenhum campo é único além do `id`.

### 5.2 Estrutura de pastas esperada (alto nível)

```
products-service/
├── docs/specs/scaffold.md
├── docker-compose.yaml
├── .env / .env.example
└── src/
    ├── config/          → configuração do banco
    ├── products/        → módulo de produtos
    │   └── entities/    → entidade Product
    ├── app.module
    └── main
```

## 6. Variáveis de ambiente

| Variável      | Descrição                         | Valor em desenvolvimento |
| ------------- | --------------------------------- | ------------------------ |
| `PORT`        | Porta HTTP do products-service    | `3001`                   |
| `DB_HOST`     | Host do PostgreSQL                | `localhost`              |
| `DB_PORT`     | Porta do PostgreSQL no host       | `5436`                   |
| `DB_USERNAME` | Usuário do banco                  | `postgres`               |
| `DB_PASSWORD` | Senha do banco                    | `postgres`               |
| `DB_DATABASE` | Nome do database                  | `products_db`            |

> Os outros serviços também usam `NODE_ENV` para ligar ou desligar a sincronização do schema e o log de SQL. Para manter o mesmo comportamento, `NODE_ENV=development` pode ser incluída no `.env` e no `.env.example`.

## 7. Fora do escopo

Fica para specs futuras:
- Endpoints HTTP (criar, listar, buscar, atualizar e desativar produtos).
- Autenticação, JWT e autorização (por exemplo, só vendedores cadastram produtos).
- DTOs de entrada e saída.
- Regras de negócio (controle de estoque, validação de preço, verificação do vendedor no users-service etc.).
- Comunicação com outros serviços (HTTP ou RabbitMQ).
- Migrations, seeds e dados iniciais.
- Swagger e health check.
- Testes além dos que o CLI já gera.

## 8. Critérios de aceite

| #     | Critério                                                                                                                                                   | Como verificar                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CA-01 | Com `docker compose up -d` na pasta do serviço, sobe um container `products-db` rodando PostgreSQL 15.                                                     | `docker ps` mostra `products-db` com a imagem `postgres:15`.                             |
| CA-02 | O banco aceita conexões na porta **5436** do host e o database `products_db` existe.                                                                       | Conectar em `localhost:5436` com as credenciais do `.env` e listar os databases.          |
| CA-03 | O `products-db` sobe com os bancos dos outros serviços (`users-db`, `payments-db`, `checkout-db`) já rodando, sem erro de porta ocupada.                   | Subir todos os bancos e conferir no `docker ps`.                                         |
| CA-04 | `pnpm install` termina sem erros e o `package.json` contém `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator` e `class-transformer`. | Ler o `package.json` e rodar a instalação.                                               |
| CA-05 | Com o banco no ar, `pnpm run start:dev` inicia a aplicação sem erros e mostra no console a mensagem de inicialização com a porta 3001.                      | Observar o console.                                                                      |
| CA-06 | Sem `PORT` definida, a aplicação sobe na porta 3001.                                                                                                       | Remover `PORT` do `.env`, iniciar e conferir a porta.                                    |
| CA-07 | Mudar os valores de conexão no `.env` muda o banco usado, sem alterar código.                                                                              | Apontar `DB_PORT` para uma porta errada: a aplicação deve falhar ao conectar.            |
| CA-08 | Depois de iniciar a aplicação, existe a tabela `products` no `products_db` com **exatamente** as 9 colunas da seção 5.1, com os tipos indicados.            | Inspecionar a tabela no banco.                                                           |
| CA-09 | A coluna `id` é UUID e é gerada automaticamente ao inserir um registro sem `id`.                                                                           | Inserir um registro sem `id` direto no banco e conferir o valor gerado.                  |
| CA-10 | Ao inserir um produto sem `stock` e sem `isActive`, o registro fica com `stock = 0` e `isActive = true`.                                                   | Inserção manual no banco e consulta.                                                     |
| CA-11 | `price` guarda exatamente 2 casas decimais (ex.: `19.9` fica `19.90`) e rejeita valores acima de 99.999.999,99.                                            | Inserir `19.9` e `100000000` direto no banco.                                            |
| CA-12 | `name` aceita 255 caracteres e rejeita 256.                                                                                                                | Inserções manuais nos limites.                                                           |
| CA-13 | `sellerId` aceita qualquer UUID válido sem exigir que ele exista em outra tabela, e rejeita valores que não são UUID.                                      | Inserir um UUID aleatório (aceito) e o texto `abc` (rejeitado).                          |
| CA-14 | Não existe nenhuma chave estrangeira na tabela `products`.                                                                                                 | Inspecionar as constraints da tabela.                                                    |
| CA-15 | `createdAt` e `updatedAt` são preenchidos automaticamente na inserção, e `updatedAt` muda quando o registro é alterado pela aplicação.                     | Inserir, atualizar e comparar os timestamps.                                             |
| CA-16 | O módulo `products` existe, está registrado no módulo raiz e **não** expõe rotas.                                                                          | Os logs de inicialização não listam rotas do módulo `products`.                          |
| CA-17 | O ValidationPipe global está ativo com whitelist, rejeição de propriedades extras e transformação.                                                         | Revisão do bootstrap da aplicação.                                                       |
| CA-18 | Existe `.env.example` com as variáveis da seção 6 sem valores, e o `.env` não é versionado.                                                               | Ler o `.env.example`; `git status` não mostra o `.env`.                                  |
| CA-19 | `pnpm run build` e `pnpm run lint` terminam sem erros.                                                                                                    | Rodar os comandos.                                                                       |

## 9. Pontos de atenção

- **Porta do banco:** o pedido original indicava a porta **5434** para o `products_db`, mas ela já é usada pelo `payments-db` (payments-service). Com as duas no mesmo valor, os dois bancos não conseguem rodar ao mesmo tempo. Esta spec usa **5436**, a próxima porta livre na sequência dos serviços. Se a 5434 for mesmo a escolhida, é a porta do payments-service que precisa mudar.
- **Valor de `price` no TypeORM:** colunas decimais do PostgreSQL costumam chegar à aplicação como texto, não como número. Isso não afeta esta spec, mas precisa ser tratado na spec dos endpoints, para que o preço seja devolvido como número.
- **Validação do vendedor:** como não existe chave estrangeira, nada impede gravar um `sellerId` que não existe no users-service. A conferência do vendedor (e se ele tem a role `seller`) fica para a spec de criação de produto.

## 10. Commits

Faça sempre um commit após cada implementação desta spec.
