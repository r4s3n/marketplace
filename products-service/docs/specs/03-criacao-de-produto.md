# SPEC: Criação de produto no products-service

| Campo        | Valor                                                    |
| ------------ | -------------------------------------------------------- |
| Serviço      | products-service                                         |
| Sistema      | marketplace-ms                                           |
| Tipo         | Funcionalidade / endpoint HTTP                           |
| Status       | Pronta para planejamento                                 |
| Data         | 2026-10-12                                               |
| Depende de   | `01-scaffold.md` e `02-validacao-de-jwt.md` (products-service) |

---

## 1. Objetivo

Permitir que vendedores cadastrem produtos no marketplace. Ao final desta spec, o products-service deve expor o endpoint **`POST /products`**, que valida os dados recebidos, confere se o usuário autenticado é um `seller`, grava o produto vinculado a esse vendedor e devolve o produto criado.

Esta é a primeira rota de negócio do serviço.

## 2. Ponto de partida

Já existe (entregue pelas specs 01 e 02):

- Projeto NestJS com pnpm, rodando na porta **3001**, com TypeORM e PostgreSQL via Docker Compose (database `products_db`).
- Módulo `products` com a entidade `Product` (`id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`) já registrada no TypeORM.
- `ProductsService` **vazio** e registrado no `ProductsModule`. **Não existe** controller de produtos.
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`.
- Autenticação JWT global: `JwtAuthGuard` registrado via `APP_GUARD`, decorator `@Public()` e `req.user` com `id`, `email` e `role` (`seller` ou `buyer`).
- Enum local de roles (`seller`, `buyer`) e tipo do usuário autenticado dentro do módulo `auth`.

## 3. Requisitos funcionais

### RF-01: ProductsService

1. **RF-01.1** — O `ProductsService` existente passa a oferecer a operação de **criar produto**.
2. **RF-01.2** — A operação recebe os dados validados do produto (seção 4.1) e o **usuário autenticado** (`id`, `email`, `role`).
3. **RF-01.3** — A regra de autorização por role (RF-04) faz parte dessa operação, para que possa ser testada unitariamente sem HTTP.
4. **RF-01.4** — O service usa o repositório de `Product` já disponibilizado pelo `ProductsModule`. Nenhuma alteração na entidade é necessária.

### RF-02: ProductsController

1. **RF-02.1** — Deve existir um `ProductsController` que responde no prefixo de rota **`/products`**.
2. **RF-02.2** — O controller deve ser registrado no `ProductsModule`.
3. **RF-02.3** — O controller **não** é marcado com `@Public()`. A rota fica protegida pelo guard global, sem declarar guard próprio.
4. **RF-02.4** — O controller apenas repassa ao service o corpo validado e o usuário autenticado (`req.user`). Nenhuma regra de negócio fica no controller.

### RF-03: Endpoint de criação

1. **RF-03.1** — Método e rota: **`POST /products`**.
2. **RF-03.2** — Corpo da requisição: JSON conforme o DTO da seção 4.1.
3. **RF-03.3** — Em caso de sucesso, responde **201 Created** com o produto criado no formato da seção 4.2.

### RF-04: Apenas sellers podem criar produtos

1. **RF-04.1** — Antes de gravar, o serviço verifica o `role` do usuário autenticado.
2. **RF-04.2** — Se o `role` **não** for `seller`, a requisição é rejeitada com **403 Forbidden** e **nada** é gravado.
3. **RF-04.3** — A mensagem do 403 deve ser clara e em português (ex.: `Apenas vendedores podem criar produtos`).
4. **RF-04.4** — A verificação usa o enum de roles já existente no módulo `auth`, sem comparar com texto solto.
5. **RF-04.5** — Não deve ser criado RoleGuard nem decorator de roles nesta spec (decisão mantida da spec 02).

### RF-05: `sellerId` vem do token

1. **RF-05.1** — O `sellerId` do produto é **sempre** o `id` do usuário autenticado (`req.user.id`).
2. **RF-05.2** — O `sellerId` **não** faz parte do DTO. Se o cliente enviar `sellerId` no corpo, a requisição é rejeitada com **400** (comportamento do `ValidationPipe` global), e nada é gravado.
3. **RF-05.3** — Não há consulta ao users-service para confirmar o vendedor: o token já validado é a fonte da informação (validação stateless, como na spec 02).

### RF-06: `isActive` automático

1. **RF-06.1** — Todo produto criado por este endpoint tem `isActive = true`, definido pelo próprio serviço.
2. **RF-06.2** — O valor de `isActive` não vem do cliente. Enviar `isActive` no corpo resulta em **400**.

### RF-07: Validação dos dados de entrada

1. **RF-07.1** — Todos os campos do DTO (seção 4.1) devem ser validados **antes** de qualquer acesso ao banco.
2. **RF-07.2** — Se houver qualquer erro, a requisição é rejeitada com **400 Bad Request** e nada é gravado.
3. **RF-07.3** — A resposta 400 deve listar **todos** os erros encontrados (não só o primeiro), cada um com uma mensagem clara, em português, dizendo qual campo falhou e por quê (seção 4.3).
4. **RF-07.4** — Propriedades não previstas no DTO (ex.: `id`, `sellerId`, `isActive`, `createdAt`) fazem a requisição ser rejeitada com 400.
5. **RF-07.5** — Não há conversão automática de tipos: `price` e `stock` enviados como texto (ex.: `"10.50"`, `"5"`) são erro de validação.

### RF-08: Ordem das verificações

Como o guard global e a validação de entrada rodam antes da regra de negócio, a ordem de avaliação de uma requisição é:

1. Autenticação → **401** se falhar.
2. Validação do corpo → **400** se falhar.
3. Verificação de role → **403** se não for `seller`.
4. Gravação → **201**.

Consequência esperada e aceita: um `buyer` que envia um corpo inválido recebe **400**, não 403. Em nenhum caso um `buyer` consegue gravar um produto.

## 4. Estrutura de dados

### 4.1 DTO de entrada: `CreateProductDto`

O DTO **não** contém `sellerId`, `isActive`, `id`, `createdAt` nem `updatedAt`.

| Campo         | Tipo    | Obrigatório | Regras                                                                                         | Mensagem de erro esperada (exemplo)                                                                                         |
| ------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string  | sim         | Não pode ser vazio. Máximo de **255** caracteres.                                              | `name é obrigatório` / `name deve ser um texto` / `name deve ter no máximo 255 caracteres`                                   |
| `description` | string  | sim         | Texto livre. Não pode ser vazio. Sem limite de tamanho.                                        | `description é obrigatório` / `description deve ser um texto`                                                               |
| `price`       | number  | sim         | Número com no máximo **2** casas decimais. Mínimo **0.01**. Máximo **99999999.99** (limite da coluna). | `price é obrigatório` / `price deve ser um número com no máximo 2 casas decimais` / `price deve ser no mínimo 0.01` / `price deve ser no máximo 99999999.99` |
| `stock`       | integer | sim         | Número inteiro. Mínimo **0**. Máximo **2147483647** (limite da coluna).                        | `stock é obrigatório` / `stock deve ser um número inteiro` / `stock deve ser no mínimo 0` / `stock deve ser no máximo 2147483647` |

Regras gerais:

- `name` e `description` devem ser strings; outro tipo (número, objeto, `null`) é erro de validação.
- `price` e `stock` devem ser números JSON; strings, `null`, `NaN` e `Infinity` são erro de validação.
- `stock` com casas decimais (ex.: `2.5`) é erro de validação.
- Nenhum outro campo é aceito.

Exemplo de corpo válido:

```json
{
  "name": "Teclado mecânico",
  "description": "Teclado mecânico ABNT2 com switches marrons",
  "price": 349.9,
  "stock": 15
}
```

### 4.2 Resposta de sucesso (201)

| Campo         | Tipo               | Observação                                        |
| ------------- | ------------------ | ------------------------------------------------- |
| `id`          | UUID               | Gerado pelo banco.                                |
| `name`        | string             | Como foi gravado.                                 |
| `description` | string             | Como foi gravado.                                 |
| `price`       | number             | Devolvido como **número**, não como texto.        |
| `stock`       | number (inteiro)   |                                                   |
| `sellerId`    | UUID               | Igual ao `id` do usuário do token.                |
| `isActive`    | boolean            | Sempre `true` neste endpoint.                     |
| `createdAt`   | data/hora ISO 8601 |                                                   |
| `updatedAt`   | data/hora ISO 8601 |                                                   |

Exemplo:

```json
{
  "id": "9b2e4c1a-7f3d-4e8b-a6c5-1d2f3e4a5b6c",
  "name": "Teclado mecânico",
  "description": "Teclado mecânico ABNT2 com switches marrons",
  "price": 349.9,
  "stock": 15,
  "sellerId": "3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90",
  "isActive": true,
  "createdAt": "2026-10-12T14:00:00.000Z",
  "updatedAt": "2026-10-12T14:00:00.000Z"
}
```

### 4.3 Respostas de erro

As respostas de erro seguem o formato padrão de exceções HTTP do NestJS, igual ao users-service.

| Status | Quando                                                      | `message`                                              | `error`        |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| 400    | Algum campo inválido, ausente ou não previsto.              | **Lista** com uma mensagem por erro encontrado.        | `Bad Request`  |
| 401    | Sem token, token inválido, adulterado ou expirado.          | `Unauthorized` (comportamento da spec 02, sem detalhes técnicos). | —   |
| 403    | Usuário autenticado não é `seller`.                         | Texto único, ex.: `Apenas vendedores podem criar produtos`. | `Forbidden` |

Exemplo de 400:

```json
{
  "statusCode": 400,
  "message": [
    "name é obrigatório",
    "price deve ser no mínimo 0.01",
    "stock deve ser um número inteiro"
  ],
  "error": "Bad Request"
}
```

Exemplo de 403:

```json
{
  "statusCode": 403,
  "message": "Apenas vendedores podem criar produtos",
  "error": "Forbidden"
}
```

### 4.4 Estrutura de pastas esperada (alto nível)

```
products-service/
├── docs/specs/03-criacao-de-produto.md
├── src/
│   ├── auth/                    → sem alterações
│   ├── products/
│   │   ├── dto/                 → CreateProductDto (novo)
│   │   ├── entities/            → Product (sem alterações)
│   │   ├── products.controller  → novo
│   │   ├── products.service     → passa a criar produto
│   │   └── products.module      → registra o controller
│   ├── app.module               → sem alterações
│   └── main                     → sem alterações
└── test/
    └── e2e de POST /products
```

## 5. Fluxo da criação

1. O cliente envia `POST /products` com `Authorization: Bearer <token>` e o corpo da seção 4.1.
2. O guard global valida o token. Se falhar → **401**. Fim.
3. A validação do corpo roda. Se falhar → **400** com a lista de erros. Fim.
4. O service confere o `role` do usuário autenticado. Se não for `seller` → **403**. Fim.
5. O produto é gravado com os dados recebidos, `sellerId = req.user.id` e `isActive = true`.
6. O serviço responde **201** com o produto criado (seção 4.2).

## 6. Requisitos não funcionais

- **RNF-01** — Nenhuma dependência nova deve ser adicionada (as bibliotecas de validação já existem no projeto).
- **RNF-02** — A entidade `Product`, o módulo `auth` e a configuração de inicialização (porta, banco, `ValidationPipe`, CORS) não mudam.
- **RNF-03** — Nenhuma chamada a outros serviços durante a criação.
- **RNF-04** — Comentários curtos em português, como no restante do código.

## 7. Fora do escopo

Fica para specs futuras:

- Listagem, consulta por id, atualização, ativação/desativação e remoção de produtos.
- Upload de imagens.
- Categorias.
- RoleGuard ou decorator de roles.
- Conferir no users-service se o vendedor existe ou está ativo.
- Regras de unicidade de nome de produto (o mesmo seller pode criar produtos com nomes iguais).
- Publicação de eventos (RabbitMQ) sobre o produto criado.
- Rota de produtos no api-gateway.
- Swagger e documentação de API.

## 8. Critérios de aceite

### Estrutura

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-01 | Existe o `ProductsController` registrado no `ProductsModule`, e a rota `POST /products` aparece nos logs de inicialização.             | Iniciar a aplicação e conferir o mapeamento de rotas no console.       |
| CA-02 | O controller não tem `@Public()` nem guard próprio, e não contém regra de negócio.                                                     | Revisão de código.                                                     |
| CA-03 | O `CreateProductDto` não contém `sellerId` nem `isActive`.                                                                              | Revisão de código.                                                     |
| CA-04 | Nenhuma dependência foi adicionada ao `package.json`.                                                                                  | Comparar o `package.json` antes e depois.                              |

### Sucesso

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-05 | Com token de `seller` e o corpo de exemplo da seção 4.1, a resposta é **201** com os 9 campos da seção 4.2.                            | Requisição HTTP e conferência do corpo.                                |
| CA-06 | O `sellerId` da resposta e do registro no banco é igual ao `sub` do token usado.                                                       | Resposta HTTP + consulta na tabela `products`.                         |
| CA-07 | O produto criado tem `isActive = true` na resposta e no banco.                                                                         | Resposta HTTP + consulta na tabela `products`.                         |
| CA-08 | `price` vem na resposta como número (ex.: `349.9`), não como texto.                                                                    | Conferir o tipo do campo no JSON.                                      |
| CA-09 | Limites aceitos: `price = 0.01`, `stock = 0` e `name` com exatamente 255 caracteres retornam **201**.                                  | Requisições nos limites.                                               |

### Autenticação e autorização

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-10 | Sem header `Authorization` → **401**, e nada é gravado.                                                                                | Requisição HTTP + contagem na tabela.                                  |
| CA-11 | Token inválido ou expirado → **401**, e nada é gravado.                                                                                | Requisição HTTP + contagem na tabela.                                  |
| CA-12 | Com token de `buyer` e corpo válido → **403** com `error = Forbidden` e mensagem em português, e nada é gravado.                       | Requisição HTTP + contagem na tabela.                                  |
| CA-13 | Com token de `buyer` e corpo inválido → **400** (ordem da RF-08), e nada é gravado.                                                    | Requisição HTTP.                                                       |

### Validação

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-14 | Corpo vazio (`{}`) retorna **400** com mensagens para os 4 campos obrigatórios.                                                        | Requisição com `{}`.                                                   |
| CA-15 | `name` vazio ou com 256 caracteres → **400** com mensagem sobre `name`.                                                                | Requisições HTTP.                                                      |
| CA-16 | `description` vazio ou de tipo diferente de string → **400** com mensagem sobre `description`.                                         | Requisições HTTP.                                                      |
| CA-17 | `price` igual a `0`, negativo, com 3 casas decimais (ex.: `10.555`) ou acima de `99999999.99` → **400** com mensagem sobre `price`.    | Requisições HTTP.                                                      |
| CA-18 | `stock` negativo, decimal (ex.: `2.5`) ou acima de `2147483647` → **400** com mensagem sobre `stock`.                                  | Requisições HTTP.                                                      |
| CA-19 | `price` ou `stock` enviados como texto (ex.: `"10.50"`, `"5"`) → **400**.                                                              | Requisições HTTP.                                                      |
| CA-20 | Enviar `sellerId` no corpo → **400**, e nenhum produto é gravado com esse `sellerId`.                                                  | Requisição HTTP + consulta no banco.                                   |
| CA-21 | Enviar `isActive`, `id` ou outro campo não previsto → **400**, e nada é gravado.                                                       | Requisição HTTP + consulta no banco.                                   |
| CA-22 | Um corpo com vários erros ao mesmo tempo retorna **todos** eles na lista `message`.                                                    | Requisição com `name`, `price` e `stock` inválidos.                    |
| CA-23 | Todas as mensagens de validação estão em português e citam o nome do campo.                                                           | Conferir as respostas 400.                                             |

### Qualidade

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-24 | Existem testes unitários do `ProductsService` cobrindo: criação por `seller`, `sellerId` vindo do usuário autenticado, `isActive = true`, e rejeição de `buyer` com 403 sem acessar o repositório. | `pnpm run test`.                                                       |
| CA-25 | Existe teste unitário do `ProductsController` confirmando que ele repassa o corpo e o usuário autenticado ao service.                  | `pnpm run test`.                                                       |
| CA-26 | O teste unitário existente do `ProductsService` continua passando após o service passar a depender do repositório.                     | `pnpm run test`.                                                       |
| CA-27 | Existem testes e2e de `POST /products` cobrindo 201, 400, 401 e 403.                                                                   | `pnpm run test:e2e`.                                                   |
| CA-28 | `pnpm run build`, `pnpm run lint`, `pnpm run test` e `pnpm run test:e2e` terminam sem erros.                                           | Rodar os comandos.                                                     |

### Interoperabilidade com o users-service

| #     | Critério                                                                                                                               | Como verificar                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA-29 | Um `seller` real faz login no users-service (`POST http://localhost:3000/auth/login`) e cria um produto em `POST http://localhost:3001/products` com o token recebido → **201**, com `sellerId` igual ao id desse usuário. | Teste manual com os dois serviços no ar. |
| CA-30 | Um `buyer` real, com o token do login, recebe **403** no mesmo endpoint.                                                               | Teste manual com os dois serviços no ar.                               |

## 9. Pontos de atenção

- **Porta do banco:** o pedido desta spec cita a porta 5434 para o PostgreSQL do products-service, mas o projeto usa **5436** (definida na spec 01; a 5434 é do payments-db). Esta spec não altera isso.
- **`price` como texto:** o PostgreSQL devolve colunas `decimal` como string. A resposta deste endpoint deve trazer `price` como número (seção 4.2). Vale tratar isso de forma que as futuras rotas de consulta também devolvam número.
- **Limites máximos de `price` e `stock`:** não estavam no pedido original. Foram incluídos porque a coluna `price` aceita no máximo `99999999.99` e a coluna `stock` é um inteiro de 32 bits; sem esses limites, valores maiores causariam erro **500** no banco em vez de **400**.
- **Ordem 400 × 403:** como não há RoleGuard (decisão da spec 02), a validação do corpo acontece antes da verificação de role. Um `buyer` com corpo inválido vê 400. Se no futuro for necessário responder 403 antes de validar, isso exige um RoleGuard em spec própria.
- **Role desatualizado no token:** se um usuário mudar de `buyer` para `seller` (ou o contrário) no users-service, o products-service só percebe quando um novo token for emitido. Isso é aceito, como na spec 02.
- **Teste unitário existente:** o `ProductsService` passa a depender do repositório de `Product`; o teste unitário gerado pelo CLI precisa fornecer esse repositório (mock) para continuar passando.
- **E2e e banco:** os testes e2e de criação precisam decidir entre usar o PostgreSQL do Docker Compose ou um repositório simulado. Se usarem o banco real, ele precisa estar no ar e os testes devem limpar os produtos que criarem.
- **api-gateway:** esta spec não expõe a rota pelo gateway. Quando isso for feito, o gateway precisa repassar o header `Authorization` e preservar os status 400, 401 e 403.

## 10. Commits

Faça sempre um commit após cada implementação desta spec.

- Cada etapa (DTO de criação, criação no `ProductsService` com a regra de role, `ProductsController` e registro no módulo, testes unitários, testes e2e) deve gerar um **commit separado**.
- Antes de cada commit, rodar o lint do products-service e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico do projeto (ex.: `feat(products): ...`, `test(products): ...`, `docs(specs): ...`), em português e descrevendo a etapa de forma objetiva.
