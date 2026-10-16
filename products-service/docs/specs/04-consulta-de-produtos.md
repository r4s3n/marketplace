# SPEC: Consulta de produtos no products-service

| Campo        | Valor                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Serviço      | products-service                                                               |
| Sistema      | marketplace-ms                                                                 |
| Tipo         | Funcionalidade / endpoints HTTP                                                |
| Status       | Pronta para planejamento                                                       |
| Data         | 2026-10-13                                                                     |
| Depende de   | `01-scaffold.md`, `02-validacao-de-jwt.md` e `03-criacao-de-produto.md` (products-service) |

---

## 1. Objetivo

Permitir que qualquer pessoa navegue pelo catálogo do marketplace. Ao final desta spec, o products-service deve expor três endpoints **públicos** de consulta:

- **`GET /products`**: lista os produtos ativos do catálogo.
- **`GET /products/seller/:sellerId`**: lista os produtos ativos de um vendedor.
- **`GET /products/:id`**: devolve um produto pelo id.

São apenas os endpoints essenciais para o funcionamento do marketplace. A criação (`POST /products`) continua protegida e não muda.

## 2. Ponto de partida

Já existe (entregue pelas specs 01, 02 e 03):

- Projeto NestJS com pnpm, rodando na porta **3001**, com TypeORM e PostgreSQL via Docker Compose (database `products_db`).
- Entidade `Product` (`id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`).
- `ProductsModule` com `ProductsController` (prefixo `/products`) e `ProductsService` com a operação de **criar produto**, usando o repositório de `Product`.
- `POST /products` funcionando, restrito a `seller`.
- Autenticação JWT global: `JwtAuthGuard` registrado via `APP_GUARD`, que protege todas as rotas por padrão, e o decorator `@Public()` para liberar rotas específicas. Em rotas públicas o guard **não** lê o header `Authorization`.
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`.

## 3. Requisitos funcionais

### RF-01: ProductsService

1. **RF-01.1** — O `ProductsService` existente passa a oferecer três operações de consulta:
   - **listar produtos ativos**;
   - **listar produtos ativos de um vendedor**, recebendo o `sellerId`;
   - **buscar produto por id**, recebendo o `id`.
2. **RF-01.2** — A regra de "não encontrado" (RF-05.3) fica no service, para poder ser testada unitariamente sem HTTP.
3. **RF-01.3** — As operações usam o repositório de `Product` já disponível. Nenhuma alteração na entidade é necessária.
4. **RF-01.4** — A operação de criar produto não muda.

### RF-02: ProductsController

1. **RF-02.1** — Os três endpoints ficam no `ProductsController` existente, no prefixo `/products`.
2. **RF-02.2** — Cada um dos três handlers de consulta é marcado individualmente com `@Public()`. O controller como um todo **não** recebe `@Public()`, para que `POST /products` continue protegido.
3. **RF-02.3** — O controller só repassa os parâmetros da rota ao service. Nenhuma regra de negócio fica no controller.

### RF-03: `GET /products`

1. **RF-03.1** — Rota **pública**: responde sem token.
2. **RF-03.2** — Retorna **todos** os produtos com `isActive = true`, de todos os vendedores.
3. **RF-03.3** — Produtos com `isActive = false` **não** aparecem.
4. **RF-03.4** — Ordenação por `createdAt` **decrescente** (mais recentes primeiro).
5. **RF-03.5** — Resposta **200** com um array de produtos (seção 4.1). Se não houver produtos ativos, responde **200** com array vazio (`[]`).
6. **RF-03.6** — Sem paginação, filtros ou busca: a lista vem completa.

### RF-04: `GET /products/seller/:sellerId`

1. **RF-04.1** — Rota **pública**: responde sem token.
2. **RF-04.2** — Retorna todos os produtos com `isActive = true` cujo `sellerId` é igual ao informado na rota.
3. **RF-04.3** — Produtos inativos do vendedor e produtos de outros vendedores **não** aparecem.
4. **RF-04.4** — Mesma ordenação do RF-03.4 (`createdAt` decrescente).
5. **RF-04.5** — Se o vendedor não tiver produtos ativos (ou não existir), responde **200** com array vazio (`[]`). Não há 404 nesta rota.
6. **RF-04.6** — Não há consulta ao users-service para saber se o vendedor existe.
7. **RF-04.7** — O `sellerId` precisa ser um UUID válido. Se não for, responde **400** (RF-06).

### RF-05: `GET /products/:id`

1. **RF-05.1** — Rota **pública**: responde sem token.
2. **RF-05.2** — Retorna o produto com o `id` informado, no formato da seção 4.1, com **200**.
3. **RF-05.3** — Se não existir produto com esse `id`, responde **404** com mensagem clara em português (ex.: `Produto não encontrado`).
4. **RF-05.4** — O produto é retornado **independente** de `isActive`: um produto inativo existente responde **200**, com `isActive = false` no corpo (ver seção 8).
5. **RF-05.5** — O `id` precisa ser um UUID válido. Se não for, responde **400** (RF-06).

### RF-06: Validação dos parâmetros de rota

1. **RF-06.1** — `:id` e `:sellerId` são validados como UUID **antes** de qualquer acesso ao banco.
2. **RF-06.2** — Valor que não é UUID (ex.: `abc`, `123`) responde **400 Bad Request** com mensagem clara, e o banco não é consultado.
3. **RF-06.3** — Em nenhum caso um parâmetro malformado pode causar erro **500**.

### RF-07: Ordem de declaração das rotas

1. **RF-07.1** — No controller, as rotas devem ser declaradas nesta ordem: primeiro `GET /products` (estática), depois `GET /products/seller/:sellerId` (com prefixo), e **por último** `GET /products/:id` (dinâmica).
2. **RF-07.2** — Motivo: se a rota dinâmica viesse antes, uma chamada a `/products/seller/...` poderia ser interpretada como `:id = "seller"`. A ordem acima garante que cada URL chegue ao handler correto.
3. **RF-07.3** — `GET /products/seller` (sem o `sellerId`) **não** é uma rota da listagem por vendedor. Ela cai em `GET /products/:id` com `id = "seller"` e responde **400** (não é UUID). Esse comportamento é aceito.

### RF-08: Rotas públicas e token

1. **RF-08.1** — As três rotas de consulta respondem igual com ou sem header `Authorization`.
2. **RF-08.2** — Um token inválido ou expirado enviado a uma rota de consulta **não** gera 401, já que o guard não lê o header em rotas públicas (comportamento da spec 02).
3. **RF-08.3** — `POST /products` continua exigindo token (**401** sem token) e role `seller` (**403** para `buyer`).

## 4. Estrutura de dados

### 4.1 Produto na resposta

Os três endpoints devolvem produtos com os mesmos campos e tipos da resposta de `POST /products` (spec 03, seção 4.2):

| Campo         | Tipo               | Observação                                                           |
| ------------- | ------------------ | -------------------------------------------------------------------- |
| `id`          | UUID               |                                                                      |
| `name`        | string             |                                                                      |
| `description` | string             |                                                                      |
| `price`       | number             | Devolvido como **número** (ex.: `349.9`), **nunca** como texto.      |
| `stock`       | number (inteiro)   |                                                                      |
| `sellerId`    | UUID               |                                                                      |
| `isActive`    | boolean            | Sempre `true` nas listagens; pode ser `false` em `GET /products/:id`. |
| `createdAt`   | data/hora ISO 8601 |                                                                      |
| `updatedAt`   | data/hora ISO 8601 |                                                                      |

Exemplo de resposta de `GET /products` (200):

```json
[
  {
    "id": "9b2e4c1a-7f3d-4e8b-a6c5-1d2f3e4a5b6c",
    "name": "Teclado mecânico",
    "description": "Teclado mecânico ABNT2 com switches marrons",
    "price": 349.9,
    "stock": 15,
    "sellerId": "3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90",
    "isActive": true,
    "createdAt": "2026-10-13T14:00:00.000Z",
    "updatedAt": "2026-10-13T14:00:00.000Z"
  }
]
```

`GET /products/seller/:sellerId` devolve um array no mesmo formato. `GET /products/:id` devolve um único objeto (não um array).

### 4.2 Respostas por endpoint

| Endpoint                          | 200                             | 400                    | 404                       |
| --------------------------------- | ------------------------------- | ---------------------- | ------------------------- |
| `GET /products`                   | Array de produtos ativos (ou `[]`) | —                   | —                         |
| `GET /products/seller/:sellerId`  | Array de produtos ativos do vendedor (ou `[]`) | `sellerId` não é UUID | —              |
| `GET /products/:id`               | Objeto do produto               | `id` não é UUID        | Produto não existe        |

Nenhuma rota de consulta responde 401 ou 403.

### 4.3 Respostas de erro

Formato padrão de exceções HTTP do NestJS, igual ao da spec 03.

Exemplo de 404:

```json
{
  "statusCode": 404,
  "message": "Produto não encontrado",
  "error": "Not Found"
}
```

Exemplo de 400 (parâmetro que não é UUID):

```json
{
  "statusCode": 400,
  "message": "id deve ser um UUID válido",
  "error": "Bad Request"
}
```

O texto exato das mensagens pode variar, desde que esteja em português e cite o parâmetro (`id` ou `sellerId`).

### 4.4 Estrutura de pastas esperada (alto nível)

```
products-service/
├── docs/specs/04-consulta-de-produtos.md
├── src/
│   ├── auth/                    → sem alterações
│   ├── products/
│   │   ├── dto/                 → sem alterações
│   │   ├── entities/            → Product (sem alterações de colunas)
│   │   ├── products.controller  → ganha os 3 GETs públicos
│   │   ├── products.service     → ganha as 3 consultas
│   │   └── products.module      → sem alterações
│   ├── app.module               → sem alterações
│   └── main                     → sem alterações
└── test/
    └── e2e das consultas de /products
```

## 5. Fluxos

### 5.1 Listagem do catálogo

1. O cliente envia `GET /products`, com ou sem token.
2. O guard global vê que a rota é pública e libera.
3. O service busca os produtos com `isActive = true`, do mais recente para o mais antigo.
4. Responde **200** com o array (ou `[]`).

### 5.2 Listagem por vendedor

1. O cliente envia `GET /products/seller/:sellerId`.
2. O guard libera (rota pública).
3. O `sellerId` é validado como UUID. Se falhar → **400**. Fim.
4. O service busca os produtos ativos desse vendedor, do mais recente para o mais antigo.
5. Responde **200** com o array (ou `[]`).

### 5.3 Consulta por id

1. O cliente envia `GET /products/:id`.
2. O guard libera (rota pública).
3. O `id` é validado como UUID. Se falhar → **400**. Fim.
4. O service busca o produto. Se não existir → **404**. Fim.
5. Responde **200** com o produto.

## 6. Requisitos não funcionais

- **RNF-01** — Nenhuma dependência nova deve ser adicionada.
- **RNF-02** — O módulo `auth`, o `ProductsModule`, o `POST /products` e a configuração de inicialização (porta, banco, `ValidationPipe`, CORS) não mudam.
- **RNF-03** — Nenhuma chamada a outros serviços durante as consultas.
- **RNF-04** — As consultas são somente leitura: nenhuma delas altera dados.
- **RNF-05** — Comentários curtos em português, como no restante do código.

## 7. Fora do escopo

Não fazem parte desta spec (e não são necessários agora):

- Atualização, ativação/desativação e remoção de produtos.
- Paginação, filtros (preço, estoque, categoria etc.), ordenação configurável e busca por texto.
- Listagem dos produtos **inativos** do próprio vendedor (painel do seller).
- Conferir no users-service se o vendedor existe.
- Cache das consultas.
- Rotas de produtos no api-gateway.
- Swagger e documentação de API.

## 8. Critérios de aceite

### Estrutura

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-01 | Ao iniciar a aplicação, os logs mostram as rotas `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id`, além de `POST /products`. | Iniciar a aplicação e conferir o mapeamento de rotas.  |
| CA-02 | No controller, as rotas estão declaradas na ordem: `GET /products`, `GET /products/seller/:sellerId`, `GET /products/:id`.               | Revisão de código.                                               |
| CA-03 | Cada GET tem `@Public()` no próprio handler; o controller e o `POST` não têm `@Public()`.                                                 | Revisão de código.                                               |
| CA-04 | O controller não contém regra de negócio (filtro de ativos, ordenação, 404).                                                              | Revisão de código.                                               |
| CA-05 | Nenhuma dependência foi adicionada ao `package.json`.                                                                                    | Comparar o `package.json` antes e depois.                        |

### `GET /products`

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-06 | Sem header `Authorization` → **200** com um array.                                                                                       | Requisição HTTP.                                                 |
| CA-07 | Com produtos ativos e inativos no banco, apenas os ativos aparecem.                                                                      | Criar produtos, desativar um direto no banco e consultar.        |
| CA-08 | Produtos de vendedores diferentes aparecem na mesma lista.                                                                               | Criar produtos com dois sellers e consultar.                     |
| CA-09 | A lista vem ordenada por `createdAt` do mais recente para o mais antigo.                                                                 | Criar 3 produtos em sequência e conferir a ordem.                |
| CA-10 | Sem nenhum produto ativo → **200** com `[]`.                                                                                             | Requisição com a tabela vazia ou só com inativos.                |
| CA-11 | Cada item tem os 9 campos da seção 4.1, com `price` como número.                                                                         | Conferir o corpo e o tipo de `price`.                            |

### `GET /products/seller/:sellerId`

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-12 | Sem header `Authorization` → **200** com um array.                                                                                       | Requisição HTTP.                                                 |
| CA-13 | Retorna apenas os produtos ativos do vendedor informado: produtos inativos dele e produtos de outros vendedores não aparecem.            | Criar produtos com dois sellers, desativar um e consultar.       |
| CA-14 | A lista vem ordenada por `createdAt` do mais recente para o mais antigo.                                                                 | Conferir a ordem.                                                |
| CA-15 | Um UUID válido sem produtos (vendedor inexistente ou sem produtos ativos) → **200** com `[]`.                                            | Requisição com UUID aleatório.                                   |
| CA-16 | `sellerId` que não é UUID (ex.: `abc`) → **400**, nunca 500.                                                                             | Requisição HTTP.                                                 |
| CA-17 | `GET /products/seller/<uuid>` chega à listagem por vendedor, e não à consulta por id.                                                    | Resposta é um array, não um objeto nem 404.                      |

### `GET /products/:id`

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-18 | Sem header `Authorization`, com o id de um produto existente → **200** com o objeto do produto (9 campos, `price` como número).          | Requisição HTTP.                                                 |
| CA-19 | Os dados retornados batem com o registro no banco.                                                                                       | Resposta HTTP + consulta na tabela `products`.                   |
| CA-20 | UUID válido sem produto correspondente → **404** com `error = Not Found` e mensagem em português.                                       | Requisição com UUID aleatório.                                   |
| CA-21 | Produto existente com `isActive = false` → **200** com `isActive: false`.                                                                | Desativar direto no banco e consultar.                           |
| CA-22 | `id` que não é UUID (ex.: `abc`, `123`) → **400**, nunca 500.                                                                            | Requisição HTTP.                                                 |

### Rotas públicas e proteção do POST

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-23 | As três rotas de consulta respondem igual sem token, com token válido (`seller` ou `buyer`) e com token inválido ou expirado.            | Requisições HTTP com cada variação.                              |
| CA-24 | `POST /products` continua respondendo **401** sem token e **403** com token de `buyer`.                                                  | Os testes e2e da spec 03 continuam passando.                     |

### Qualidade

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-25 | Existem testes unitários do `ProductsService` cobrindo: listagem só de ativos com ordenação decrescente, listagem por vendedor só de ativos, busca por id encontrada e 404 quando não encontrada. | `pnpm run test`. |
| CA-26 | Existem testes unitários do `ProductsController` confirmando que cada GET repassa os parâmetros ao service.                              | `pnpm run test`.                                                 |
| CA-27 | Existem testes e2e das três rotas cobrindo 200 sem token, lista vazia, filtro de inativos, ordenação, 400 para UUID inválido e 404.      | `pnpm run test:e2e`.                                             |
| CA-28 | Os testes unitários e e2e já existentes (specs 01, 02 e 03) continuam passando.                                                           | `pnpm run test` e `pnpm run test:e2e`.                           |
| CA-29 | `pnpm run build`, `pnpm run lint`, `pnpm run test` e `pnpm run test:e2e` terminam sem erros.                                             | Rodar os comandos.                                               |

### Interoperabilidade com o users-service

| #     | Critério                                                                                                                                 | Como verificar                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CA-30 | Um `seller` real faz login no users-service, cria um produto em `POST http://localhost:3001/products`, e o produto aparece, sem token, em `GET /products`, em `GET /products/seller/<id do seller>` e em `GET /products/<id do produto>`. | Teste manual com os dois serviços no ar. |

## 9. Pontos de atenção

- **`price` como texto:** o PostgreSQL devolve colunas `decimal` como string. Em `POST /products` isso não aparece, porque a resposta reaproveita o valor enviado; nas consultas o valor vem do banco e chegaria como `"349.90"`. Todas as rotas de consulta devem devolver `price` como **número** (seção 4.1), igual ao `POST`. Como resolver fica para o plano, mas a solução não pode alterar as colunas da tabela.
- **Ordem das rotas:** é o ponto mais fácil de errar nesta spec (RF-07). O CA-17 existe para pegar essa regressão.
- **UUID inválido → 400:** o pedido original lista apenas 200 e 404. O 400 foi incluído porque a coluna `id`/`sellerId` é do tipo `uuid` no PostgreSQL, e consultar com um valor que não é UUID gera erro no banco, o que viraria **500**. Validar antes evita o 500 e não consulta o banco à toa.
- **Produto inativo em `GET /products/:id`:** o pedido diz apenas "404 se o produto não existir". A spec mantém isso ao pé da letra: produto inativo existe e responde 200 com `isActive: false`. Isso permite que outros serviços (ex.: o orders-service, no checkout) consultem o produto e decidam o que fazer com ele. O front-end do catálogo deve tratar `isActive: false` como "indisponível". Se a decisão for esconder produtos inativos também nessa rota (404), basta trocar o RF-05.4 e o CA-21 antes de planejar.
- **Ordenação estável:** produtos criados no mesmo instante têm `createdAt` igual e podem vir em qualquer ordem entre si. Os testes de ordenação devem criar os produtos com tempo suficiente entre eles (ou definir `createdAt` diferentes direto no banco) para não ficarem instáveis.
- **Como deixar um produto inativo nos testes:** não existe endpoint para desativar produto (fora do escopo). Os testes que precisam de produto inativo devem alterá-lo direto no banco ou no repositório simulado.
- **Token em rota pública:** um token inválido enviado a uma rota de consulta é ignorado, sem 401 (RF-08.2). É o comportamento atual do `JwtAuthGuard` e não deve mudar.
- **Volume:** sem paginação, `GET /products` devolve o catálogo inteiro. É aceito neste momento; paginação fica para uma spec própria quando o volume justificar.
- **api-gateway:** esta spec não expõe as rotas pelo gateway. Quando isso for feito, o gateway deve permitir as três consultas sem token e preservar os status 400 e 404.

## 10. Commits

Faça sempre um commit após cada implementação desta spec.

- Cada etapa deve gerar um **commit separado**, por exemplo: consultas no `ProductsService` (incluindo o `price` como número), GETs públicos no `ProductsController`, testes unitários, testes e2e.
- Antes de cada commit, rodar o lint do products-service e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico do projeto (ex.: `feat(products): ...`, `test(products): ...`, `docs(specs): ...`), em português e descrevendo a etapa de forma objetiva.
