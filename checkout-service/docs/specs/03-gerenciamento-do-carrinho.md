# SPEC: Gerenciamento do carrinho no checkout-service

| Campo        | Valor                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Serviço      | checkout-service                                                                        |
| Sistema      | marketplace-ms                                                                          |
| Tipo         | Regra de negócio / integração HTTP entre serviços / API REST                            |
| Status       | Pronta para planejamento                                                                |
| Data         | 2026-10-14                                                                              |
| Depende de   | `02-entidades-e-validacao-de-jwt.md` (checkout-service), `04-consulta-de-produtos.md` (products-service) |

---

## 1. Objetivo

Permitir que o usuário autenticado (seller ou buyer) monte o seu carrinho de compras no checkout-service (porta 3003):

1. Criar o **ProductsClientService**, que consulta produtos no products-service (porta 3001) via HTTP.
2. Expor três rotas protegidas:
   - `POST /cart/items`: adiciona um produto ao carrinho;
   - `GET /cart`: mostra o carrinho;
   - `DELETE /cart/items/:itemId`: remove um item do carrinho.
3. Manter o `total` do carrinho sempre igual à soma dos subtotais dos itens.

Ao final desta spec, o usuário consegue adicionar, consultar e remover itens do próprio carrinho. Ainda **não** existe finalização de compra nem criação de pedido.

## 2. Ponto de partida

### 2.1 O que já existe

- Entidades `Cart` (`carts`) e `CartItem` (`cart_items`) com `CartStatus` (`active`, `completed`, `abandoned`), criadas na spec 02. `Cart.items` tem **cascade** e **eager**, e as colunas decimais são lidas como número.
- `CartModule` em `src/cart/`, que só registra os repositórios. Ainda não tem controller nem service.
- `JwtAuthGuard` global, `@Public()` e `req.user` com `id`, `email` e `role`.
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`.
- Swagger em `/api`, com Bearer e a tag `Health`.
- `@nestjs/axios` (4.0.1) e `axios` (1.19.0) **já declarados** no `package.json`.
- `PRODUCTS_SERVICE_URL=http://localhost:3001` no `.env`, e a chave sem valor no `.env.example`.

### 2.2 Comportamento do products-service usado por esta spec

Definido na spec `04-consulta-de-produtos.md` do products-service:

| Situação                              | Resposta de `GET /products/:id`                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Produto existe e está ativo           | **200** com o produto (`id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive: true`, `createdAt`, `updatedAt`) |
| Produto existe e está **inativo**     | **200** com o produto e `isActive: false`. **Não** responde 404.                      |
| UUID válido sem produto               | **404** com `message` em português                                                    |
| `id` não é UUID                       | **400**                                                                               |

A rota é **pública**: o checkout-service não precisa enviar token.

### 2.3 Diagnóstico do pedido x código atual

| #  | Pedido / suposição                                    | Estado real no código                                                                 | Decisão                                                                                   |
| -- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D1 | PostgreSQL do checkout na porta **5436**.             | O checkout usa **5435** desde a spec 01. A 5436 é do products-service.                | **Não** alterar a porta. Esta spec não mexe na conexão.                                   |
| D2 | Usar `HttpModule` do `@nestjs/axios`.                 | `@nestjs/axios` e `axios` já estão instalados, mas não são usados em nenhum lugar.     | Nenhuma dependência nova (RF-01).                                                         |
| D3 | Validar se o produto "existe e está ativo".           | O products-service devolve **200** para produto inativo (seção 2.2).                  | O checkout **precisa** checar `isActive` no corpo da resposta. Não basta tratar o 404.    |

### 2.4 Decisões de projeto

Pontos que o pedido não define e que esta spec decide:

| #  | Questão                                                              | Decisão                                                                                                                                       |
| -- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 | O que `GET /cart` faz quando não existe carrinho ativo?              | Responde **200** com um carrinho vazio **sem gravar nada no banco** (RF-07). O carrinho só é criado na primeira adição de item.               |
| P2 | Qual preço vale quando o mesmo produto é adicionado de novo?         | O item tem **um único preço**. Na nova adição, `price` e `productName` são atualizados para os valores atuais do produto, e o subtotal é recalculado com o novo preço e a quantidade somada (RN-04). |
| P3 | Status do erro para produto inativo.                                 | **400** com a mensagem `Produto indisponível`.                                                                                                |
| P4 | Status do erro quando o products-service está fora ou demora.        | **503** com a mensagem `Serviço de produtos indisponível`.                                                                                     |
| P5 | Remover o último item apaga o carrinho?                              | **Não**. O carrinho continua `active`, com `items` vazio e `total` 0.                                                                          |
| P6 | Item de outro usuário em `DELETE /cart/items/:itemId`.               | **404**, igual a um item inexistente. A resposta não revela que o item existe em outro carrinho.                                              |
| P7 | Validar estoque (`stock`) ao adicionar?                              | **Não** nesta spec. O estoque muda até a compra e será validado na finalização (próxima spec).                                                |
| P8 | Seller pode adicionar o próprio produto ao carrinho?                 | **Sim**, sem restrição nesta spec (ver Pontos de atenção).                                                                                     |

## 3. Escopo

### Dentro do escopo

- `ProductsClientModule` e `ProductsClientService`, com `getProduct(productId)`.
- `CartService` e `CartController` com as três rotas.
- DTO de entrada do `POST /cart/items` e o formato de resposta do carrinho.
- Regras de carrinho ativo único, snapshot de preço e nome, cálculo de subtotal e total, e posse do carrinho.
- Garantias no banco contra carrinho ativo duplicado e item duplicado (RF-12).
- Documentação das rotas no Swagger (tag `Cart`).
- Testes unitários e e2e.

### Fora do escopo

- Checkout, finalização da compra, criação de `Order` e `OrderItem`, e publicação de mensagem no RabbitMQ. Ficam para a próxima spec.
- Alterar a quantidade de um item já no carrinho (ex.: `PATCH /cart/items/:itemId`). Para mudar a quantidade, o usuário remove o item e adiciona de novo.
- Esvaziar o carrinho inteiro de uma vez (ex.: `DELETE /cart`).
- Validação e reserva de estoque.
- Mudança de status do carrinho para `completed` ou `abandoned`.
- Atualização automática dos itens quando o preço ou o status do produto muda no products-service.
- Integração das rotas de carrinho com o api-gateway.
- Qualquer alteração em `src/events/`, `src/orders/`, `src/auth/` e `src/health/`.
- Alterações no users-service, no products-service, no payments-service e no api-gateway.

---

## 4. Requisitos funcionais: integração com o products-service

### RF-01: Dependências

1. **RF-01.1**: usar `@nestjs/axios` e `axios`, já declarados no `package.json`.
2. **RF-01.2**: nenhuma dependência é adicionada ou atualizada nesta spec.

### RF-02: Configuração

1. **RF-02.1**: a URL base do products-service vem **exclusivamente** da variável `PRODUCTS_SERVICE_URL`. Nenhuma URL fica fixa no código.
2. **RF-02.2**: sem `PRODUCTS_SERVICE_URL`, ou com a variável vazia, a aplicação **não sobe** e mostra um erro claro no console, como já acontece com o `JWT_SECRET`.
3. **RF-02.3**: as requisições ao products-service têm **timeout de 5 segundos**. Esse valor é fixo e não vira variável de ambiente nesta spec.
4. **RF-02.4**: o `.env.example` mantém a chave `PRODUCTS_SERVICE_URL` sem valor (já está assim).

### RF-03: `ProductsClientModule`

1. **RF-03.1**: módulo em `src/products-client/` que configura o `HttpModule` com a URL base (RF-02.1) e o timeout (RF-02.3).
2. **RF-03.2**: fornece e **exporta** o `ProductsClientService`, para ser importado pelo `CartModule`.
3. **RF-03.3**: sem controllers e sem rotas.

### RF-04: Contrato do produto retornado

1. **RF-04.1**: tipo local do checkout-service com os campos usados pelo carrinho: `id`, `name`, `price`, `stock`, `isActive` e `sellerId`. O checkout-service **não** importa código do products-service.
2. **RF-04.2**: `price` e `stock` chegam ao chamador como **número**, mesmo que o products-service mude e passe a mandar texto.
3. **RF-04.3**: campos extras da resposta (`description`, `createdAt`, `updatedAt` ou outros) não fazem parte do contrato e são descartados.

### RF-05: `ProductsClientService.getProduct(productId)`

1. **RF-05.1**: faz `GET {PRODUCTS_SERVICE_URL}/products/:productId` e devolve o produto no contrato da RF-04.
2. **RF-05.2**: **não** envia o token do usuário nem nenhum outro header de autenticação. A rota é pública.
3. **RF-05.3**: **não** decide se o produto pode ir para o carrinho. Ele devolve produtos ativos **e** inativos. A regra de `isActive` fica no `CartService` (RN-03).
4. **RF-05.4**: tratamento de falhas:

| Resposta do products-service                                     | Resultado de `getProduct`                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 200                                                              | Produto no contrato da RF-04                                           |
| 404                                                              | Erro **404** com a mensagem `Produto não encontrado`                    |
| Qualquer outro status (4xx ou 5xx)                               | Erro **503** com a mensagem `Serviço de produtos indisponível`          |
| Sem resposta: conexão recusada, DNS, timeout (RF-02.3)           | Erro **503** com a mensagem `Serviço de produtos indisponível`          |

5. **RF-05.5**: toda falha que vira 503 é registrada no log do checkout-service (Logger do NestJS) com o `productId` e o motivo técnico. O motivo técnico (stack, mensagem do axios, URL interna) **não** aparece na resposta ao cliente.
6. **RF-05.6**: não faz retry nem cache.

## 5. Regras de negócio

- **RN-01: Carrinho ativo único.** Cada usuário tem **no máximo um** carrinho com status `active`. Carrinhos `completed` ou `abandoned` do mesmo usuário não contam e não são usados pelas rotas desta spec.
- **RN-02: Posse.** O dono do carrinho é **sempre** o `req.user.id`. Nenhuma rota recebe `userId` ou `cartId` do cliente. O usuário só lê e altera o próprio carrinho ativo.
- **RN-03: Produto válido.** Só entra no carrinho um produto que existe no products-service **e** tem `isActive: true`.
- **RN-04: Snapshot.** `productName` e `price` do `CartItem` são copiados do products-service no momento da adição. Depois disso, mudanças no products-service **não** alteram o item. Se o mesmo produto for adicionado de novo, o snapshot é atualizado para os valores do momento dessa nova adição (decisão P2).
- **RN-05: Um item por produto.** Um carrinho tem no máximo **um** `CartItem` por `productId`. Adicionar um produto que já está no carrinho **soma** a quantidade no item existente, sem criar outro item.
- **RN-06: Subtotal.** `subtotal = price × quantity`, com 2 casas decimais.
- **RN-07: Total.** `total` do carrinho = soma dos `subtotal` de **todos** os itens do carrinho, com 2 casas decimais. Carrinho sem itens tem `total` 0. O total é recalculado a partir dos itens após **toda** adição ou remoção, e o valor gravado em `carts.total` é sempre igual ao valor devolvido na resposta.
- **RN-08: Precisão.** Subtotal e total não podem ter erro de ponto flutuante. Exemplos: 3 × 19.99 = **59.97**; itens com subtotais 0.10 e 0.20 somam **0.30**, e não 0.30000000000000004.
- **RN-09: Preço vem do servidor.** Preço e nome **nunca** vêm do corpo da requisição, só do products-service.
- **RN-10: Atomicidade.** Cada adição ou remoção é tudo ou nada: se qualquer passo falhar, nenhuma mudança (carrinho novo, item, quantidade ou total) fica gravada.

## 6. Requisitos funcionais: carrinho

### RF-06: Formato da resposta do carrinho

As três rotas devolvem o carrinho no mesmo formato:

| Campo        | Tipo                    | Descrição                                                                                 |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| `id`         | uuid ou `null`          | `null` quando o usuário ainda não tem carrinho ativo (RF-07.3).                           |
| `userId`     | uuid                    | Sempre o `req.user.id`.                                                                   |
| `status`     | texto                   | Sempre `active` nesta spec.                                                               |
| `total`      | número                  | RN-07. Número, não texto.                                                                 |
| `items`      | lista                   | Itens do carrinho, do **mais antigo para o mais recente** (`createdAt` crescente).        |
| `createdAt`  | data ISO 8601 ou `null` | `null` quando não existe carrinho ativo.                                                  |
| `updatedAt`  | data ISO 8601 ou `null` | `null` quando não existe carrinho ativo.                                                  |

Cada item de `items`:

| Campo         | Tipo           | Descrição                                       |
| ------------- | -------------- | ----------------------------------------------- |
| `id`          | uuid           | Usado em `DELETE /cart/items/:itemId`.          |
| `productId`   | uuid           | Produto do products-service.                    |
| `productName` | texto          | Snapshot (RN-04).                               |
| `price`       | número         | Preço unitário do snapshot (RN-04).             |
| `quantity`    | inteiro        | ≥ 1.                                            |
| `subtotal`    | número         | RN-06.                                          |
| `createdAt`   | data ISO 8601  | Momento em que o item entrou no carrinho.       |

1. **RF-06.1**: os itens **não** trazem `cart` nem `cartId`. O carrinho **não** traz campos além dos listados.
2. **RF-06.2**: o formato é documentado no Swagger, com exemplo.

Exemplo de carrinho com um item:

```json
{
  "id": "6f1c2b0e-8a4d-4f7e-9b1a-2d3c4e5f6a7b",
  "userId": "0b7e9c1a-3d2f-4e5a-8b6c-7d8e9f0a1b2c",
  "status": "active",
  "total": 59.97,
  "items": [
    {
      "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "productId": "c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f",
      "productName": "Teclado mecânico",
      "price": 19.99,
      "quantity": 3,
      "subtotal": 59.97,
      "createdAt": "2026-10-14T20:00:00.000Z"
    }
  ],
  "createdAt": "2026-10-14T20:00:00.000Z",
  "updatedAt": "2026-10-14T20:00:00.000Z"
}
```

### RF-07: `GET /cart`

1. **RF-07.1**: rota **protegida** (sem `@Public()`).
2. **RF-07.2**: com carrinho ativo, responde **200** com o carrinho no formato da RF-06.
3. **RF-07.3**: sem carrinho ativo, responde **200** com o carrinho vazio: `id` `null`, `userId` do usuário, `status` `active`, `total` 0, `items` vazio, `createdAt` e `updatedAt` `null`.
4. **RF-07.4**: **não** cria carrinho no banco. Chamadas repetidas sem carrinho ativo não gravam nada.
5. **RF-07.5**: **não** chama o products-service. Os valores vêm do snapshot gravado, e a rota funciona mesmo com o products-service fora do ar.

### RF-08: `POST /cart/items`

1. **RF-08.1**: rota **protegida**.
2. **RF-08.2**: corpo da requisição:

| Campo       | Obrigatório | Regra                                     | Mensagem de erro (400)                          |
| ----------- | ----------- | ----------------------------------------- | ----------------------------------------------- |
| `productId` | sim         | UUID                                      | `productId deve ser um UUID válido`             |
| `quantity`  | sim         | Número **inteiro** ≥ 1. Texto (ex.: `"2"`) não é aceito. | `quantity deve ser um número inteiro maior ou igual a 1` |

3. **RF-08.3**: qualquer outro campo no corpo (ex.: `price`, `productName`, `userId`, `cartId`) é rejeitado com **400** pelo `ValidationPipe` global (RN-09).
4. **RF-08.4**: fluxo:
   1. valida o corpo (RF-08.2). Se for inválido → **400**, sem chamar o products-service;
   2. busca o produto com `ProductsClientService.getProduct`. Se o produto não existir → **404** `Produto não encontrado`. Se o serviço estiver indisponível → **503** `Serviço de produtos indisponível`;
   3. se `isActive` for `false` → **400** `Produto indisponível`;
   4. busca o carrinho ativo do usuário. Se não existir, cria um com `status` `active` e `total` 0;
   5. se o produto já estiver no carrinho: soma `quantity` à quantidade atual, atualiza `productName` e `price` (RN-04) e recalcula o `subtotal`;
   6. se não estiver: cria o item com o snapshot de `productName` e `price`, a `quantity` recebida e o `subtotal`;
   7. recalcula o `total` (RN-07) e grava tudo de forma atômica (RN-10);
   8. responde **201** com o carrinho completo e atualizado (RF-06).
5. **RF-08.5**: se o passo 2 ou 3 falhar, **nenhum** carrinho é criado. Um usuário sem carrinho que tenta adicionar um produto inexistente continua sem carrinho.

### RF-09: `DELETE /cart/items/:itemId`

1. **RF-09.1**: rota **protegida**.
2. **RF-09.2**: `itemId` que não é UUID → **400** `itemId deve ser um UUID válido`, sem consultar o banco.
3. **RF-09.3**: responde **404** `Item não encontrado no carrinho` quando:
   - o usuário não tem carrinho ativo;
   - o item não existe;
   - o item existe, mas pertence ao carrinho de **outro** usuário (P6);
   - o item existe, mas pertence a um carrinho do próprio usuário que não está `active`.
4. **RF-09.4**: quando o item pertence ao carrinho ativo do usuário: remove o item do banco, recalcula o `total` (RN-07), grava de forma atômica (RN-10) e responde **200** com o carrinho atualizado (RF-06).
5. **RF-09.5**: ao remover o último item, o carrinho continua existindo, `active`, com `items` vazio e `total` 0 (P5).
6. **RF-09.6**: **não** chama o products-service.
7. **RF-09.7**: o 404 não altera nenhum carrinho, nem o do usuário nem o do dono real do item.

### RF-10: Respostas de erro

1. **RF-10.1**: todos os erros seguem o formato padrão do NestJS (`statusCode`, `message` e `error`), com mensagens em português.
2. **RF-10.2**: nenhuma resposta de erro expõe stack trace, SQL, URL interna do products-service ou mensagem do axios.
3. **RF-10.3**: tabela resumo:

| Rota                         | 200 | 201 | 400                                   | 401          | 404                                 | 503                         |
| ---------------------------- | --- | --- | ------------------------------------- | ------------ | ----------------------------------- | --------------------------- |
| `GET /cart`                  | sim | —   | —                                     | sem token    | —                                   | —                           |
| `POST /cart/items`           | —   | sim | corpo inválido; produto inativo       | sem token    | produto não existe                  | products-service indisponível |
| `DELETE /cart/items/:itemId` | sim | —   | `itemId` não é UUID                   | sem token    | item fora do carrinho ativo do usuário | —                        |

### RF-11: `CartModule`, service e controller

1. **RF-11.1**: o `CartModule` passa a importar o `ProductsClientModule` e a declarar o `CartService` e o `CartController`. O registro das entidades com `TypeOrmModule.forFeature` continua igual.
2. **RF-11.2**: o `CartController` só recebe a requisição, extrai o `req.user.id` e repassa ao service. Regras de negócio (RN-01 a RN-10), chamadas ao products-service e acesso ao banco ficam no `CartService`.
3. **RF-11.3**: o controller **não** declara o `JwtAuthGuard`. A proteção vem do guard global.
4. **RF-11.4**: o `AppModule` não muda: o `CartModule` já está registrado.

### RF-12: Garantias no banco

1. **RF-12.1**: o banco impede dois carrinhos com status `active` para o mesmo `userId` (índice único parcial em `carts`, válido só para `status = active`). Carrinhos `completed` e `abandoned` do mesmo usuário continuam permitidos.
2. **RF-12.2**: o banco impede dois itens com o mesmo `productId` no mesmo carrinho (índice único em `cart_items` por `cartId` + `productId`).
3. **RF-12.3**: duas primeiras adições simultâneas do mesmo usuário **não** criam dois carrinhos nem respondem 500. As duas terminam com sucesso, usando o mesmo carrinho.
4. **RF-12.4**: as colunas, os tipos, os padrões e as FKs da spec 02 não mudam. Só os dois índices são adicionados, criados pelo `synchronize` em desenvolvimento.

## 7. Requisitos funcionais: documentação

### RF-13: Swagger

1. **RF-13.1**: a tag `Cart` é adicionada à configuração do Swagger no `main.ts`, com uma descrição curta. O restante do bootstrap não muda.
2. **RF-13.2**: as três rotas aparecem na tag `Cart`, marcadas com autenticação Bearer, com um resumo da operação e as respostas da RF-10.3.
3. **RF-13.3**: o corpo do `POST /cart/items` aparece com os dois campos, as regras e um exemplo.
4. **RF-13.4**: a resposta de sucesso das três rotas mostra o formato da RF-06.

## 8. Fluxo esperado do `POST /cart/items`

```
POST /cart/items { productId, quantity }  (Authorization: Bearer <token>)
   │
   ▼
JwtAuthGuard (global) ── token inválido ──► 401
   │
   ▼
ValidationPipe ── corpo inválido ou campo extra ──► 400
   │
   ▼
CartService
   │
   ├── ProductsClientService.getProduct(productId) ──► GET products-service /products/:id
   │      ├── 404 ─────────────────────────────────► 404 Produto não encontrado
   │      └── erro, timeout ou outro status ───────► 503 Serviço de produtos indisponível
   │
   ├── isActive = false ───────────────────────────► 400 Produto indisponível
   │
   ▼
Transação
   ├── busca o carrinho ativo do usuário (cria se não existir)
   ├── produto já no carrinho? soma quantidade e atualiza snapshot : cria item
   ├── subtotal = price × quantity
   └── total = Σ subtotais
   │
   ▼
201 com o carrinho completo
```

## 9. Estrutura de pastas esperada (alto nível)

```
checkout-service/
├── docs/specs/03-gerenciamento-do-carrinho.md
├── src/
│   ├── products-client/
│   │   ├── products-client.module   → HttpModule com URL base e timeout
│   │   ├── products-client.service  → getProduct(productId)
│   │   └── interfaces/              → contrato do produto (RF-04)
│   ├── cart/
│   │   ├── cart.module              → importa ProductsClientModule
│   │   ├── cart.controller          → GET /cart, POST /cart/items, DELETE /cart/items/:itemId
│   │   ├── cart.service             → regras de negócio
│   │   ├── dto/                     → corpo do POST e resposta do carrinho
│   │   └── entities/                → índices únicos da RF-12
│   └── main                         → tag Cart no Swagger
└── test/
    └── cart.e2e-spec                → rotas do carrinho com products-service simulado
```

## 10. Variáveis de ambiente

Nenhuma variável nova.

| Variável               | Descrição                         | Valor em desenvolvimento   |
| ---------------------- | --------------------------------- | -------------------------- |
| `PRODUCTS_SERVICE_URL` | URL base do products-service      | `http://localhost:3001`    |

## 11. Critérios de aceite

Nos critérios abaixo, "produto ativo", "produto inativo" e "produto inexistente" se referem às respostas do products-service descritas na seção 2.2. Nos testes automatizados, essas respostas vêm de um products-service simulado. Nos testes manuais, vêm do products-service real.

### Integração com o products-service

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-01 | Nenhuma dependência foi adicionada ou atualizada no `package.json`.                                                                              | `git diff package.json` vazio.                                                  |
| CA-02 | Com `PRODUCTS_SERVICE_URL` vazia ou ausente, a aplicação não sobe e mostra um erro sobre a variável.                                             | Esvaziar a variável no `.env`, rodar `pnpm run start:dev` e depois restaurar.   |
| CA-03 | Nenhuma URL do products-service aparece fixa em `src/`.                                                                                          | Buscar `localhost:3001` e `3001` em `src/`.                                     |
| CA-04 | `getProduct` devolve o produto com `id`, `name`, `price`, `stock`, `isActive` e `sellerId`, com `price` e `stock` numéricos, inclusive quando o products-service manda `price` como texto. | Teste unitário com `HttpService` simulado.                   |
| CA-05 | `getProduct` devolve produtos inativos sem erro.                                                                                                 | Teste unitário.                                                                 |
| CA-06 | `getProduct` com 404 do products-service falha com 404 `Produto não encontrado`.                                                                 | Teste unitário.                                                                 |
| CA-07 | `getProduct` com 500, com conexão recusada e com timeout falha com 503 `Serviço de produtos indisponível`, e registra o motivo no log.            | Teste unitário, um por cenário.                                                 |
| CA-08 | A requisição ao products-service não leva header `Authorization`.                                                                                | Teste unitário verificando a chamada ao `HttpService`.                          |

### `GET /cart`

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-09 | Sem token → 401.                                                                                                                                 | Teste e2e.                                                                      |
| CA-10 | Usuário sem carrinho → 200 com `id` `null`, `userId` do token, `status` `active`, `total` 0, `items` vazio e datas `null`.                        | Teste e2e.                                                                      |
| CA-11 | Chamar `GET /cart` sem carrinho ativo **não** cria registro em `carts`.                                                                          | Teste e2e consultando a tabela depois da chamada.                               |
| CA-12 | Com itens no carrinho → 200 com o formato da RF-06, itens em ordem de entrada, `total` e `price` numéricos, e sem `cart` nem `cartId` nos itens. | Teste e2e.                                                                      |
| CA-13 | Usuário com carrinho `completed` e sem carrinho ativo recebe o carrinho vazio.                                                                   | Teste e2e com um carrinho `completed` inserido no banco.                        |
| CA-14 | `GET /cart` funciona com o products-service fora do ar e não faz nenhuma chamada a ele.                                                          | Teste e2e com o client simulado verificando zero chamadas; teste manual com o products-service parado. |

### `POST /cart/items`

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-15 | Sem token → 401.                                                                                                                                 | Teste e2e.                                                                      |
| CA-16 | Primeira adição de um produto ativo (`price` 19.99, `quantity` 3) por um usuário sem carrinho → 201, carrinho criado com 1 item, `subtotal` 59.97 e `total` 59.97. | Teste e2e.                                                                |
| CA-17 | O item gravado tem `productName` e `price` iguais aos do products-service no momento da adição.                                                  | Teste e2e consultando `cart_items`.                                             |
| CA-18 | Adicionar de novo o mesmo produto (`quantity` 2) → continua 1 item, com `quantity` 5, `subtotal` = 5 × preço e `total` atualizado.               | Teste e2e.                                                                      |
| CA-19 | Se o preço do produto mudou entre as duas adições (19.99 → 25.00), o item fica com `price` 25.00, `quantity` somada e `subtotal` = 25.00 × quantidade total. | Teste e2e mudando a resposta do client simulado.                         |
| CA-20 | Adicionar um segundo produto cria um segundo item, e `total` = soma dos dois subtotais.                                                          | Teste e2e.                                                                      |
| CA-21 | Subtotais 0.10 e 0.20 resultam em `total` exatamente 0.3.                                                                                        | Teste unitário do `CartService`.                                                |
| CA-22 | `carts.total` gravado no banco é igual ao `total` da resposta depois de cada adição.                                                             | Teste e2e consultando `carts`.                                                  |
| CA-23 | Produto inexistente → 404 `Produto não encontrado`, e nenhum carrinho ou item é criado.                                                          | Teste e2e.                                                                      |
| CA-24 | Produto inativo → 400 `Produto indisponível`, e nenhum carrinho ou item é criado.                                                                | Teste e2e.                                                                      |
| CA-25 | products-service indisponível → 503 `Serviço de produtos indisponível`, sem detalhes técnicos no corpo, e nada é gravado.                         | Teste e2e com o client simulado falhando; teste manual com o products-service parado. |
| CA-26 | `productId` ausente ou não UUID → 400 com a mensagem da RF-08.2, sem chamar o products-service.                                                  | Teste e2e verificando zero chamadas ao client simulado.                         |
| CA-27 | `quantity` ausente, 0, -1, 1.5 ou `"2"` (texto) → 400 com a mensagem da RF-08.2.                                                                 | Teste e2e, um por valor.                                                        |
| CA-28 | Corpo com `price`, `productName`, `userId` ou `cartId` → 400, e o preço gravado nunca vem do corpo.                                              | Teste e2e.                                                                      |
| CA-29 | Seller e buyer conseguem adicionar itens ao próprio carrinho.                                                                                    | Teste e2e com tokens dos dois roles.                                            |
| CA-30 | Duas adições simultâneas do mesmo usuário sem carrinho → as duas respondem 201 e existe **um** único carrinho `active` para ele.                  | Teste e2e disparando as duas requisições em paralelo.                           |

### `DELETE /cart/items/:itemId`

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-31 | Sem token → 401.                                                                                                                                 | Teste e2e.                                                                      |
| CA-32 | Com 2 itens, remover um → 200, carrinho com o item restante e `total` igual ao subtotal dele; o item removido não existe mais em `cart_items`.    | Teste e2e.                                                                      |
| CA-33 | Remover o último item → 200, mesmo `id` de carrinho, `items` vazio, `total` 0, e o carrinho continua `active` no banco.                            | Teste e2e.                                                                      |
| CA-34 | `itemId` não UUID → 400 `itemId deve ser um UUID válido`.                                                                                        | Teste e2e.                                                                      |
| CA-35 | UUID de item inexistente → 404 `Item não encontrado no carrinho`.                                                                                | Teste e2e.                                                                      |
| CA-36 | Usuário sem carrinho ativo → 404.                                                                                                                | Teste e2e.                                                                      |
| CA-37 | Usuário A tenta remover um item do carrinho do usuário B → 404, e o carrinho de B continua com o item e o mesmo `total`.                          | Teste e2e com dois tokens.                                                      |
| CA-38 | Remover um item de um carrinho `completed` do próprio usuário → 404.                                                                              | Teste e2e com dados inseridos no banco.                                         |
| CA-39 | A remoção não chama o products-service.                                                                                                          | Teste e2e verificando zero chamadas ao client simulado.                         |

### Posse, banco e consistência

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-40 | Itens adicionados pelo usuário A não aparecem no `GET /cart` do usuário B.                                                                        | Teste e2e com dois tokens.                                                      |
| CA-41 | Inserir um segundo carrinho `active` para o mesmo `userId` direto no banco falha. Inserir um `completed` para o mesmo usuário funciona.           | SQL no `checkout_db` ou teste e2e.                                              |
| CA-42 | Inserir dois `cart_items` com o mesmo `cartId` e `productId` direto no banco falha.                                                               | SQL no `checkout_db`.                                                           |
| CA-43 | Se a gravação falhar no meio de uma adição, nenhum carrinho, item ou total parcial fica gravado.                                                 | Teste unitário do `CartService` simulando falha na gravação.                    |

### Swagger, não regressão e qualidade

| #     | Critério                                                                                                                                         | Como verificar                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CA-44 | `http://localhost:3003/api` mostra a tag `Cart` com as três rotas, cadeado Bearer, corpo do POST com exemplo e as respostas da RF-10.3.          | Abrir no navegador.                                                             |
| CA-45 | Fluxo manual completo com os serviços reais: login no users-service, criação de produto no products-service, adição, consulta e remoção no checkout. | Teste manual com users-service (3000), products-service (3001) e checkout-service (3003) no ar. |
| CA-46 | `GET /health` continua público e as rotas existentes continuam com o mesmo comportamento.                                                        | Testes e2e existentes passando.                                                 |
| CA-47 | Nenhum arquivo em `src/events/`, `src/orders/`, `src/auth/` e `src/health/` foi alterado.                                                        | `git diff --stat` nessas pastas vazio.                                          |
| CA-48 | Existem testes unitários do `ProductsClientService`, do `CartService` (todas as RN e os erros) e do `CartController`.                              | `pnpm run test`.                                                                |
| CA-49 | Os testes e2e do carrinho usam um products-service simulado e não dependem do products-service real.                                             | Rodar `pnpm run test:e2e` com o products-service parado.                        |
| CA-50 | `pnpm run build`, `pnpm run lint` e `pnpm run test` terminam sem erros. `pnpm run test:e2e` passa com o `checkout-db` e o RabbitMQ no ar.          | Rodar os comandos.                                                              |
| CA-51 | Nenhum arquivo de outro serviço (users, products, payments, api-gateway) foi alterado.                                                           | `git status` nos outros repositórios.                                           |

## 12. Pontos de atenção

- **Produto inativo responde 200:** o products-service não esconde produtos inativos em `GET /products/:id`. Se o checkout tratar só o 404, produtos inativos entram no carrinho. A checagem de `isActive` (RN-03) é obrigatória.
- **Snapshot desatualizado:** o carrinho guarda o preço do momento da adição. Se o seller mudar o preço ou desativar o produto depois, o carrinho continua mostrando o valor antigo. A próxima spec (checkout) precisa decidir se revalida preço, status e estoque antes de criar o pedido.
- **Estoque não validado:** é possível adicionar mais unidades do que o `stock` atual (decisão P7). A validação fica para a finalização.
- **Seller comprando o próprio produto:** não há restrição nesta spec. Se a regra do marketplace proibir, ela deve entrar aqui ou na spec de checkout comparando `sellerId` com `req.user.id`.
- **Concorrência na quantidade:** os índices únicos (RF-12) impedem carrinho e item duplicados, mas duas adições simultâneas do **mesmo** produto ainda podem disputar a mesma linha. A implementação deve garantir que nenhuma das duas quantidades se perca, ou tratar o conflito sem responder 500.
- **Limite do decimal(10,2):** `subtotal` e `total` aceitam até 99.999.999,99. Uma `quantity` muito grande com um preço alto passa desse limite e o banco recusa a gravação. Se isso acontecer, a resposta não pode ser 500 sem tratamento. Se um limite máximo de `quantity` for desejado, ele deve ser definido antes do plano.
- **Eager e QueryBuilder:** `Cart.items` é eager só nos métodos do repositório (`find`, `findOne`). Consultas com QueryBuilder precisam carregar os itens explicitamente, senão a resposta sai com `items` vazio e o `total` é recalculado errado.
- **Cascade ao remover item:** tirar um item da lista `items` e salvar o carrinho **não** apaga a linha em `cart_items`, porque a relação não tem remoção de órfãos. A remoção do item precisa ser explícita.
- **Ordem das rotas:** `GET /cart` e `POST /cart/items` não têm parâmetro, e `DELETE /cart/items/:itemId` só aceita UUID. Não há conflito de rota, mas rotas futuras como `DELETE /cart` devem respeitar isso.
- **Índice parcial e `synchronize`:** o índice único da RF-12.1 depende de condição no status. Se já existirem dois carrinhos `active` para o mesmo usuário no banco de desenvolvimento, o `synchronize` falha ao criar o índice. Nesse caso, limpar os dados de teste antes de subir.
- **Timeout:** 5 segundos é o tempo máximo que o usuário espera na adição quando o products-service trava. O api-gateway, quando integrado, deve ter um timeout maior que esse.
- **Porta do banco:** o pedido citava 5436, mas o checkout usa **5435** desde a spec 01. Esta spec não muda isso.
- **E2e e infraestrutura:** os e2e do carrinho precisam do `checkout-db`, porque testam gravação, índices e transação. O products-service é substituído por um client simulado, e cada teste deve limpar `carts` e `cart_items` para não depender da ordem de execução.

## 13. Commits

Esta aula termina com **um único commit** no repositório do checkout-service.

- O commit inclui esta spec e toda a implementação: `ProductsClientModule`, `CartService`, `CartController`, DTOs, índices das entidades, tag do Swagger e testes.
- O `.env` é ignorado pelo git e não entra no commit.
- Antes do commit, rodar `pnpm run lint`, `pnpm run build` e `pnpm run test` e garantir que tudo passa.
- A mensagem segue o padrão do histórico, em português. Sugestão: `feat(cart): adiciona, consulta e remove itens do carrinho`.
