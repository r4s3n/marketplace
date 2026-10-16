# SPEC: Integração do products-service com o api-gateway

| Campo        | Valor                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Serviços     | products-service e api-gateway                                                                          |
| Sistema      | marketplace-ms                                                                                          |
| Tipo         | Integração / observabilidade / documentação de API                                                      |
| Status       | Pronta para planejamento                                                                                |
| Data         | 2026-10-13                                                                                              |
| Depende de   | `01` a `04` (products-service) e `06-integracao-com-api-gateway.md` (users-service)                     |

---

## 1. Objetivo

Permitir que um cliente use **apenas o api-gateway (porta 3005)** para fazer login, cadastrar produtos e navegar pelo catálogo. O gateway valida o JWT quando a rota exige e encaminha a requisição ao products-service (porta 3001).

O products-service também passa a ser **observável** (health) e **documentado** (Swagger).

## 2. Ponto de partida

### 2.1 products-service (porta 3001)

Já existe (specs 01 a 04):

- Entidade `Product` e `ProductsModule` com `ProductsController` (prefixo `/products`) e `ProductsService`.
- `POST /products`: protegido, restrito a `seller` (403 para `buyer`), com validação do corpo (400 com lista de mensagens).
- `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id`: públicos, com 400 para UUID inválido e 404 para produto inexistente.
- `JwtAuthGuard` global via `APP_GUARD`, decorator `@Public()` e `JWT_SECRET` igual ao do users-service.
- Rota `GET /` herdada do scaffold, protegida pelo guard global.
- **Não** possui `GET /health` nem documentação Swagger.

### 2.2 api-gateway (porta 3005)

Já existe:

- `ProxyService` com circuit breaker, retry, timeout e fallback. Ele já conhece o serviço `products` e repassa ao cliente o status e o corpo dos erros 4xx dos serviços.
- `serviceConfig.products.url` lido de `PRODUCTS_SERVICE_URL`.
- `JwtStrategy` registrada e `JwtAuthGuard`, que respeitam o metadado `isPublic`. O `JWT_SECRET` é o mesmo do users-service e do products-service.
- `POST /auth/login` e `POST /auth/register` funcionando contra o users-service (spec 06 do users-service).
- Rotas `/users/*` encaminhadas pelo `ProxyService` em um módulo próprio (`UsersModule`), que serve de **modelo** para esta spec.
- Health check que consulta `GET {url}/health` de cada serviço configurado, inclusive `products`.
- Swagger em `/api`, já com a tag `Products` declarada.

### 2.3 Lacunas identificadas no estado atual

Uma análise do código mostrou que, hoje, o fluxo ponta a ponta de produtos **não funciona** pelo gateway. Cada lacuna é tratada por um requisito desta spec:

| #  | Lacuna                                                                                                                                                                          | Tratada em |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| L1 | O products-service não expõe `GET /health`; o gateway sempre o considera **unhealthy**.                                                                                         | RF-01      |
| L2 | O products-service não tem documentação Swagger.                                                                                                                                | RF-02      |
| L3 | O gateway **não expõe nenhuma rota `/products/*`**. O `ProxyService` sabe falar com o serviço `products`, mas nenhum controller o usa; hoje `GET :3005/products` responde 404.   | RF-04      |
| L4 | O `.env.example` do gateway deixa `PRODUCTS_SERVICE_URL` vazio e diz que o `JWT_SECRET` precisa ser igual apenas ao do users-service.                                             | RF-03      |

Já está correto e só precisa ser **confirmado** (RF-03): o `.env` do gateway contém `PRODUCTS_SERVICE_URL=http://localhost:3001`, e o `JWT_SECRET` é o mesmo nos três serviços.

## 3. Escopo

### Dentro do escopo

**products-service**
- `GET /health`.
- Documentação Swagger/OpenAPI em `/api`.

**api-gateway**
- Conferência e documentação das variáveis de ambiente.
- Exposição de `POST /products`, `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id`, encaminhadas pelo `ProxyService` existente.
- Uso do `JwtAuthGuard` existente apenas em `POST /products`.
- Documentação das rotas de produtos no Swagger do gateway.
- Passo a passo do fluxo E2E no README do gateway.

### Fora do escopo

- Qualquer alteração no `ProxyService`, circuit breaker, retry, timeout, fallback ou cache do gateway.
- Qualquer alteração na lógica do `JwtAuthGuard`, `JwtStrategy`, `SessionGuard` ou `RoleGuard` do gateway.
- Novos endpoints de negócio no products-service (atualização, remoção, paginação, filtros etc.).
- Mudança de contrato (status, campos, mensagens) das rotas de produtos existentes.
- Autorização por role no gateway: a regra "apenas seller cria produto" continua **só** no products-service.
- Integração de checkout e payments.

---

## 4. Requisitos funcionais: products-service

### RF-01: `GET /health`

1. **RF-01.1** — Rota **pública**: marcada com `@Public()`, não exige token e responde igual mesmo quando um token inválido ou expirado é enviado.
2. **RF-01.2** — Responde **200 OK** com exatamente dois campos: `status` com o valor `"ok"` e `service` com o valor `"products-service"`.
3. **RF-01.3** — Não depende do banco de dados nem de outros serviços para responder (verificação de liveness).
4. **RF-01.4** — Fica na raiz do serviço (`/health`), sem prefixo, pois é o caminho que o health check do gateway consulta.
5. **RF-01.5** — A rota `GET /` existente não muda de comportamento (continua protegida).
6. **RF-01.6** — Segue a mesma organização usada no users-service para o health (controller próprio ou junto do `AppController`; a escolha fica para o plano, desde que não altere `GET /`).

### RF-02: Swagger / OpenAPI

1. **RF-02.1** — A documentação é gerada automaticamente e fica acessível em **`GET /api`** (interface web) com o serviço rodando.
2. **RF-02.2** — Metadados do documento: título **"Products Service"**, versão **"1.0"** e uma descrição curta do serviço.
3. **RF-02.3** — Declara o esquema de segurança **Bearer (JWT)**, para que o token possa ser informado no botão "Authorize" e enviado nas rotas protegidas.
4. **RF-02.4** — Todas as rotas do serviço aparecem documentadas e agrupadas por tags (ex.: `Products`, `Health`):
   - `POST /products`
   - `GET /products`
   - `GET /products/seller/:sellerId`
   - `GET /products/:id`
   - `GET /health`
5. **RF-02.5** — `POST /products` aparece marcado como exigindo Bearer Auth. As três consultas e o `/health` aparecem como públicos.
6. **RF-02.6** — O corpo de `POST /products` aparece documentado com os quatro campos (`name`, `description`, `price`, `stock`), seus tipos, obrigatoriedade e limites, conforme a spec 03. `sellerId` e `isActive` **não** aparecem no corpo.
7. **RF-02.7** — O formato do produto na resposta (9 campos da spec 04, seção 4.1) aparece documentado, com `price` como número.
8. **RF-02.8** — Cada rota documenta seus códigos de resposta:
   - `POST /products`: 201, 400, 401, 403.
   - `GET /products`: 200.
   - `GET /products/seller/:sellerId`: 200, 400.
   - `GET /products/:id`: 200, 400, 404.
   - `GET /health`: 200.
9. **RF-02.9** — Os parâmetros `:id` e `:sellerId` aparecem documentados como UUID.
10. **RF-02.10** — `/api` é acessível sem token e não é bloqueado pelo `JwtAuthGuard` global.
11. **RF-02.11** — A documentação não muda nenhum contrato existente: as validações, mensagens, status e o `ValidationPipe` global continuam iguais.
12. **RF-02.12** — Pelo Swagger, depois de informar um token de `seller` no "Authorize", é possível criar um produto com `POST /products` (201).

---

## 5. Requisitos funcionais: api-gateway

### RF-03: Configuração de ambiente (verificação)

1. **RF-03.1** — O `.env` do gateway contém `PRODUCTS_SERVICE_URL=http://localhost:3001`. Já está correto; deve apenas ser confirmado.
2. **RF-03.2** — O `JWT_SECRET` do gateway é o **mesmo** do users-service e do products-service. Já está correto; deve apenas ser confirmado, sem expor o valor.
3. **RF-03.3** — O `.env.example` do gateway passa a trazer `PRODUCTS_SERVICE_URL=http://localhost:3001` e a indicar que o `JWT_SECRET` precisa ser igual ao do users-service **e** ao do products-service.
4. **RF-03.4** — Nenhum secret é versionado; os arquivos `.env` continuam ignorados pelo git.

### RF-04: Rotas de produtos no gateway

1. **RF-04.1** — O gateway expõe as rotas abaixo e encaminha cada uma ao products-service pelo **`ProxyService` existente** (serviço `products`), mantendo método e caminho:

   | Rota no gateway (3005)              | Destino no products-service (3001)  | Token no gateway |
   | ----------------------------------- | ----------------------------------- | ---------------- |
   | `POST /products`                    | `POST /products`                    | obrigatório      |
   | `GET /products`                     | `GET /products`                     | não exige        |
   | `GET /products/seller/:sellerId`    | `GET /products/seller/:sellerId`    | não exige        |
   | `GET /products/:id`                 | `GET /products/:id`                 | não exige        |

2. **RF-04.2** — As rotas ficam em um **módulo/controller próprio de produtos** no gateway, seguindo a organização do `UsersModule` (importa o `ProxyModule` e o `AuthModule` sem alterá-los), e são registradas no módulo raiz.
3. **RF-04.3** — Ordem de declaração: `GET /products` e `GET /products/seller/:sellerId` vêm **antes** de `GET /products/:id`, para que `seller` nunca seja tratado como id.
4. **RF-04.4** — Os parâmetros de rota (`:id`, `:sellerId`) são encaminhados de forma que um valor recebido do cliente **nunca** consiga alterar o caminho de destino (ex.: `..`, `/` ou `?` dentro do parâmetro).
5. **RF-04.5** — O gateway **não** valida o UUID dos parâmetros. Essa validação é do products-service, e o 400 dele é repassado ao cliente.
6. **RF-04.6** — Em `POST /products`, o corpo é encaminhado **sem alterações**: o gateway não valida, não remove e não acrescenta campos. A validação é do products-service, e o 400 dele (com a lista de mensagens) é repassado ao cliente.
7. **RF-04.7** — Em caso de sucesso, o gateway devolve ao cliente o **mesmo status** e o **mesmo corpo** retornados pelo products-service (201 com o produto criado; 200 com array ou objeto). Nenhum campo é renomeado, acrescentado ou removido.
8. **RF-04.8** — Erros 4xx do products-service (400, 401, 403, 404) chegam ao cliente com o mesmo status e a mesma mensagem. Isso já é feito pelo `ProxyService` e não deve ser reimplementado no controller.
9. **RF-04.9** — Mensagens de erro devolvidas ao cliente não expõem detalhes internos (URL do serviço, stack trace, objeto de erro do cliente HTTP).

### RF-05: Autenticação nas rotas de produtos

1. **RF-05.1** — `POST /products` é protegido pelo **`JwtAuthGuard` existente** do gateway. Sem token, com token malformado, adulterado ou expirado, o gateway responde **401** **sem** chamar o products-service.
2. **RF-05.2** — Em `POST /products`, o header `Authorization` recebido pelo gateway é **repassado intacto** ao products-service, que também valida o token e aplica a regra de role.
3. **RF-05.3** — Em `POST /products`, os dados do usuário autenticado no gateway (`userId`, `email`, `role`) são passados ao `ProxyService`, que já os envia como headers `x-user-*`. O products-service continua usando o próprio JWT como fonte da identidade (o `sellerId` vem do token, spec 03).
4. **RF-05.4** — As três rotas `GET` são **públicas** no gateway: respondem sem token e não são bloqueadas por token inválido. Se o cliente enviar `Authorization`, o gateway pode repassá-lo, mas nunca exigi-lo.
5. **RF-05.5** — A regra "apenas `seller` cria produto" **não** é aplicada no gateway. O `RoleGuard` não é usado nestas rotas; o 403 vem do products-service e é repassado ao cliente.
6. **RF-05.6** — O `SessionGuard` não é aplicado a nenhuma rota desta spec.
7. **RF-05.7** — A lógica do `JwtAuthGuard` e da `JwtStrategy` não é alterada.

### RF-06: Health check do products-service no gateway

1. **RF-06.1** — Com o products-service no ar, o health do gateway reporta o serviço `products` como **healthy**, usando o `GET /health` do RF-01.
2. **RF-06.2** — Com o products-service fora do ar, o health do gateway reporta `products` como **unhealthy** e o status geral como **degraded**, sem derrubar o gateway.
3. **RF-06.3** — O mecanismo de health check do gateway não é alterado.

### RF-07: Swagger do gateway

1. **RF-07.1** — As quatro rotas do RF-04 aparecem no Swagger do gateway (`/api`), na tag `Products` já existente.
2. **RF-07.2** — `POST /products` aparece marcado como exigindo Bearer Auth (esquema `JWT-auth` já configurado); as consultas aparecem como públicas.
3. **RF-07.3** — Cada rota documenta os status que o cliente pode receber pelo gateway (os mesmos do RF-02.8; em `POST /products`, o 401 pode vir do gateway ou do products-service).
4. **RF-07.4** — A documentação do corpo de `POST /products` no gateway, se existir, **não** pode fazer o `ValidationPipe` global do gateway rejeitar ou remover campos do corpo (ver RF-04.6 e a seção 9).

---

## 6. Fluxo esperado (via gateway, porta 3005)

Cliente → api-gateway :3005 → users-service :3000 / products-service :3001

1. **Login** — `POST /auth/login` (público). O gateway chama o users-service, que responde **200** com `user` e `token`.
2. **Criação** — `POST /products` com `Authorization: Bearer <token de seller>`.
   1. O `JwtAuthGuard` do gateway valida o token. Se o token for inválido, responde **401** e o products-service não é chamado.
   2. Se o token for válido, o `ProxyService` encaminha o corpo intacto, o `Authorization` original e os headers `x-user-*` para `POST /products` no products-service.
   3. O products-service valida o token, o corpo (400) e a role (403) e grava o produto.
   4. O gateway devolve **201** com o produto criado, sem transformação.
3. **Catálogo** — `GET /products` (público). O gateway encaminha e devolve **200** com o array de produtos ativos, incluindo o produto criado no passo 2.
4. **Produto** — `GET /products/:id` (público). O gateway encaminha e devolve **200** com o produto, **400** para id que não é UUID ou **404** para produto inexistente.
5. **Produtos do vendedor** — `GET /products/seller/:sellerId` (público). O gateway encaminha e devolve **200** com o array dos produtos ativos do vendedor.

## 7. Respostas esperadas (via gateway)

| Rota no gateway                 | Cenário                                                      | Status esperado                                  |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `POST /products`                | Token de `seller` e corpo válido                             | 201 + produto criado                             |
| `POST /products`                | Sem token, token malformado, adulterado ou expirado          | 401, respondido pelo gateway                     |
| `POST /products`                | Token de `buyer` e corpo válido                              | 403, vindo do products-service                   |
| `POST /products`                | Token válido e corpo inválido ou com campo extra             | 400 + lista de mensagens do products-service     |
| `POST /products`                | products-service fora do ar                                  | 503 ou 504, nunca 401                            |
| `GET /products`                 | Com ou sem token                                             | 200 + array (pode ser `[]`)                      |
| `GET /products/seller/:sellerId`| `sellerId` válido                                            | 200 + array (pode ser `[]`)                      |
| `GET /products/seller/:sellerId`| `sellerId` não é UUID                                        | 400                                              |
| `GET /products/:id`             | Produto existe                                               | 200 + produto                                    |
| `GET /products/:id`             | `id` não é UUID                                              | 400                                              |
| `GET /products/:id`             | UUID válido sem produto                                      | 404                                              |
| `GET /health` (gateway)         | products-service no ar                                       | `products` = healthy                             |
| `GET /health` (gateway)         | products-service fora do ar                                  | `products` = unhealthy, geral = degraded         |

## 8. Requisitos não funcionais

- **RNF-01** — products-service: a única dependência nova permitida é a biblioteca oficial de Swagger do NestJS. O gateway não ganha dependências novas.
- **RNF-02** — Os contratos existentes do products-service (`POST /products` e as três consultas) não mudam: mesmos campos, tipos, status e mensagens. `price` continua vindo como número.
- **RNF-03** — `ProxyService`, `JwtAuthGuard`, `JwtStrategy`, `SessionGuard`, `RoleGuard` e os módulos de circuit breaker, retry, timeout, fallback e health check do gateway não têm a lógica alterada.
- **RNF-04** — O `JWT_SECRET` vem exclusivamente de variável de ambiente nos três serviços.
- **RNF-05** — Os novos artefatos seguem a organização de pastas de cada serviço. No gateway, o módulo de produtos espelha o `UsersModule`.
- **RNF-06** — Comentários curtos em português, como no restante do código.

### Estrutura de pastas esperada (alto nível)

- **products-service**
  - `docs/specs/05-integracao-com-api-gateway.md` (esta spec)
  - `src/main`: passa a configurar o Swagger
  - `src/` (health): rota `GET /health` pública
  - `src/products/`: controller e DTO ganham apenas metadados de documentação
  - `test/`: e2e do `/health`
- **api-gateway**
  - `.env.example`: `PRODUCTS_SERVICE_URL` e nota sobre o `JWT_SECRET`
  - `src/products/`: novo módulo e controller de produtos, com testes unitários
  - `src/app.module`: registra o módulo de produtos
  - `README.md`: passo a passo do fluxo E2E de produtos

## 9. Pontos de atenção

Os pontos abaixo ficam fora do escopo porque o `ProxyService` não pode ser alterado. Devem ser registrados para specs futuras do gateway.

- **Fallback de `GET` com formato diferente:** com o products-service fora do ar, o `ProxyService` responde às rotas `GET` de produtos com um objeto padrão (`products`, `total`, `page`, `limit`) e status **200**, em vez de um erro. Esse formato não bate com o contrato real (array em `GET /products`, objeto do produto em `GET /products/:id`). Por isso os critérios de aceite não exigem 503 para `GET` com o serviço fora do ar.
- **Cache de fallback que nunca é usado:** o `ProxyService` grava o cache com a chave `products-<caminho>`, mas o fallback de produtos lê `Product-<caminho>`. As chaves não batem, então o fallback sempre devolve o objeto padrão em vez da última resposta boa.
- **ValidationPipe global do gateway:** ele usa `whitelist` e `forbidNonWhitelisted`. Se o corpo de `POST /products` for tipado no gateway com uma classe sem regras de validação, todos os campos podem ser rejeitados (400) ou removidos antes de chegar ao products-service. O plano deve garantir o RF-04.6 e o RF-07.4: o corpo chega intacto e as mensagens de validação vêm do products-service.
- **401 em dois lugares:** em `POST /products`, o gateway barra tokens inválidos antes de chamar o serviço. Se os `JWT_SECRET` divergirem no futuro, o gateway aceitaria um token que o products-service rejeitaria (ou o contrário). Manter o `.env.example` claro (RF-03.3) reduz esse risco.
- **Throttle global:** o `CustomThrottlerGuard` do gateway limita requisições por IP. Considerar isso ao rodar os testes manuais em sequência.
- **Rotas `GET` públicas e `x-user-*`:** em rotas públicas não há usuário autenticado no gateway, e os headers `x-user-*` seguem vazios. O products-service não depende deles, então não há impacto.

## 10. Critérios de aceite

### products-service

| #     | Critério                                                                                                                                         | Como verificar                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| CA-01 | `GET http://localhost:3001/health` sem token → **200** com exatamente `status = "ok"` e `service = "products-service"`.                            | curl / Postman.                                                   |
| CA-02 | `GET /health` com token inválido ou expirado → **200**.                                                                                          | curl / Postman.                                                   |
| CA-03 | `GET /health` responde **200** mesmo com o PostgreSQL parado (depois do serviço já iniciado).                                                    | Parar o container do banco e chamar a rota.                       |
| CA-04 | `GET /` continua exigindo token (**401** sem token).                                                                                             | Testes e2e existentes continuam passando.                         |
| CA-05 | `http://localhost:3001/api` abre sem token, com título "Products Service", versão 1.0 e botão "Authorize" (Bearer).                              | Navegador.                                                        |
| CA-06 | O Swagger lista as 5 rotas do RF-02.4. Só `POST /products` aparece com cadeado (Bearer).                                                          | Navegador.                                                        |
| CA-07 | O corpo de `POST /products` aparece com `name`, `description`, `price` e `stock` e seus limites, sem `sellerId` nem `isActive`.                  | Navegador.                                                        |
| CA-08 | Cada rota mostra os códigos de resposta do RF-02.8, e `:id`/`:sellerId` aparecem como UUID.                                                      | Navegador.                                                        |
| CA-09 | Pelo Swagger, com um token de `seller` no "Authorize", `POST /products` retorna **201**.                                                         | Navegador.                                                        |
| CA-10 | Todos os testes e2e das specs 01 a 04 continuam passando, sem mudar as asserções.                                                                | `pnpm run test:e2e`.                                              |

### api-gateway

| #     | Critério                                                                                                                                         | Como verificar                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| CA-11 | `.env` contém `PRODUCTS_SERVICE_URL=http://localhost:3001`; `.env.example` traz o mesmo valor e a nota de que o `JWT_SECRET` é compartilhado com users-service e products-service. | Revisão dos arquivos.                    |
| CA-12 | Ao iniciar o gateway, os logs mostram `POST /products`, `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id`.                 | Logs de inicialização.                                            |
| CA-13 | `POST :3005/products` sem token → **401**, e os logs do products-service mostram que nenhuma requisição chegou a ele.                             | curl + logs.                                                      |
| CA-14 | O products-service recebe o header `Authorization` original em `POST /products` vindo do gateway.                                                | Teste unitário do controller do gateway ou log.                   |
| CA-15 | `POST :3005/products` com corpo inválido → **400** com a **mesma** lista de mensagens que a chamada direta à porta 3001.                           | Comparar as duas respostas.                                       |
| CA-16 | `POST :3005/products` com token de `buyer` → **403** com a mensagem do products-service.                                                         | curl.                                                             |
| CA-17 | `GET :3005/products/:id` com o id de um produto → mesmo corpo que `GET :3001/products/:id`.                                                      | Comparar as duas respostas.                                       |
| CA-18 | `GET :3005/products/abc` → **400**; `GET :3005/products/<uuid aleatório>` → **404**.                                                              | curl.                                                             |
| CA-19 | `GET :3005/products/seller/<uuid>` responde um **array** (não é tratado como `GET /products/:id`).                                               | curl.                                                             |
| CA-20 | Um parâmetro com `..` ou `/` codificado não faz o gateway chamar outro caminho do products-service.                                              | Teste unitário do controller do gateway.                          |
| CA-21 | As três consultas respondem sem token e também com token inválido.                                                                              | curl.                                                             |
| CA-22 | Com o products-service parado, `POST :3005/products` com token válido → **503** ou **504** (não 401).                                            | Parar o serviço e chamar a rota.                                  |
| CA-23 | `GET :3005/health` mostra `products` como healthy com o serviço no ar, e `products` unhealthy com status geral degraded com o serviço parado.      | curl.                                                             |
| CA-24 | O Swagger do gateway (`:3005/api`) lista as 4 rotas na tag `Products`, com Bearer apenas em `POST /products`.                                    | Navegador.                                                        |
| CA-25 | Não há alterações em `ProxyService`, guards, `JwtStrategy`, circuit breaker, retry, timeout, fallback e health check.                            | `git diff` do gateway.                                            |

### Fluxo E2E (curl/Postman, somente pela porta 3005)

Com users-service, products-service, os bancos e o gateway no ar:

| #     | Critério                                                                                                                                         | Como verificar                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| CA-26 | `POST :3005/auth/login` com um `seller` existente → **200** com `token`.                                                                          | curl / Postman.                                                   |
| CA-27 | `POST :3005/products` com esse token e um corpo válido → **201**, com `sellerId` igual ao id do seller e `isActive = true`.                       | curl / Postman.                                                   |
| CA-28 | `GET :3005/products` sem token → **200** com um array que contém o produto do CA-27.                                                             | curl / Postman.                                                   |
| CA-29 | `GET :3005/products/<id do CA-27>` sem token → **200** com o produto, `price` como número.                                                        | curl / Postman.                                                   |
| CA-30 | `GET :3005/products/seller/<id do seller>` sem token → **200** com um array que contém o produto do CA-27.                                       | curl / Postman.                                                   |
| CA-31 | Login de um `buyer` pelo gateway e `POST :3005/products` com o token dele → **403**.                                                              | curl / Postman.                                                   |
| CA-32 | O passo a passo de CA-26 a CA-31 (comandos curl ou coleção Postman) está documentado no README do gateway, junto do fluxo de usuários já existente. | Revisão do README.                                               |

### Qualidade

| #     | Critério                                                                                                                                         | Como verificar                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| CA-33 | products-service: teste unitário do health e teste e2e cobrindo CA-01 e CA-02.                                                                   | `pnpm run test` e `pnpm run test:e2e`.                            |
| CA-34 | api-gateway: testes unitários do controller de produtos, cobrindo serviço `products`, método e caminho corretos, corpo intacto, repasse do `Authorization` e dos dados do usuário no `POST`, e caminho seguro com parâmetro malicioso. | `pnpm run test`. |
| CA-35 | `build`, `lint` e `test` passam sem erros nos dois serviços; `test:e2e` passa no products-service.                                               | Rodar os comandos.                                                |

## 11. Commits

Faça sempre um commit após cada implementação desta spec.

- products-service e api-gateway são **repositórios git distintos**: cada commit vai no repositório do serviço alterado.
- Cada etapa gera um **commit separado**. Sugestão:
  1. products-service: `GET /health` público.
  2. products-service: Swagger (dependência e configuração em `/api`).
  3. products-service: documentação das rotas e dos DTOs no Swagger.
  4. products-service: testes do health.
  5. api-gateway: `.env.example` com `PRODUCTS_SERVICE_URL` e nota do `JWT_SECRET`.
  6. api-gateway: módulo e rotas `/products` via `ProxyService`.
  7. api-gateway: testes unitários do controller de produtos.
  8. api-gateway: README com o fluxo E2E de produtos.
- Antes de cada commit, rodar o lint do serviço alterado e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico de cada repositório (ex.: `feat(health): ...`, `feat(products): ...`, `test(products): ...`, `docs: ...`), em português e descrevendo a etapa de forma objetiva.
