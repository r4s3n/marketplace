# SPEC: Integração do checkout-service com o api-gateway

| Campo        | Valor                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Serviço      | api-gateway                                                                                                                   |
| Sistema      | marketplace-ms                                                                                                                |
| Tipo         | Integração / proxy HTTP / documentação de API                                                                                 |
| Status       | Pronta para planejamento                                                                                                      |
| Data         | 2026-10-14                                                                                                                    |
| Depende de   | `03-gerenciamento-do-carrinho.md` e `04-finalizacao-do-pedido.md` (checkout-service); `05-integracao-com-api-gateway.md` (products-service); `06-integracao-com-api-gateway.md` (users-service) |

---

## 1. Objetivo

Permitir que um cliente use **apenas o api-gateway (porta 3005)** para montar o carrinho, finalizar a compra e consultar os próprios pedidos. O gateway valida o JWT e encaminha cada requisição ao checkout-service (porta 3003) pelo `ProxyService` existente, repassando o header `Authorization` original.

Ao final desta spec, o fluxo **login → adicionar ao carrinho → ver carrinho → finalizar → ver pedidos** funciona de ponta a ponta somente pela porta 3005. O pagamento **não** faz parte desta spec: o pedido continua `pending`.

## 2. Ponto de partida

### 2.1 checkout-service (porta 3003)

Já existe (specs 01 a 04 do checkout-service):

- `POST /cart/items`, `GET /cart` e `DELETE /cart/items/:itemId` (spec 03).
- `POST /cart/checkout`, `GET /orders` e `GET /orders/:id` (spec 04).
- Todas as rotas acima são protegidas pelo `JwtAuthGuard` global do checkout-service. O dono do carrinho e dos pedidos é **sempre** o usuário do token (`sub`); o serviço não usa os headers `x-user-*`.
- Validação dos corpos (`productId` UUID e `quantity` inteiro ≥ 1; `paymentMethod` em `credit_card`, `debit_card`, `pix`, `boleto`) e dos parâmetros UUID (`itemId`, `id`), com 400 e mensagens em português.
- `GET /health` público, no formato esperado pelo health check do gateway.
- Swagger próprio em `/api`.

Status de sucesso e de erro de cada rota (contrato que o gateway deve preservar):

| Rota no checkout-service       | Sucesso | Erros possíveis                                                                                         |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `POST /cart/items`             | 201     | 400 (corpo inválido, produto inativo), 401, 404 (produto não existe), 503 (products-service indisponível) |
| `GET /cart`                    | 200     | 401                                                                                                     |
| `DELETE /cart/items/:itemId`   | 200     | 400 (`itemId` não é UUID), 401, 404 (item fora do carrinho ativo do usuário)                             |
| `POST /cart/checkout`          | 201     | 400 (corpo inválido, carrinho vazio ou inexistente), 401                                                |
| `GET /orders`                  | 200     | 401                                                                                                     |
| `GET /orders/:id`              | 200     | 400 (`id` não é UUID), 401, 404 (pedido inexistente ou de outro usuário)                                 |

### 2.2 api-gateway (porta 3005)

Já existe:

- `ProxyService` com circuit breaker, retry, timeout e fallback. Ele já aceita `checkout` como nome de serviço, já tem fallback de erro (503) configurado para ele e repassa ao cliente o status e o corpo dos erros 4xx dos serviços.
- `serviceConfig.checkout` com `url` lida de `CHECKOUT_SERVICE_URL` (padrão `http://localhost:3003`) e `timeout` de 10000 ms.
- `AuthModule` com `JwtStrategy` e `JwtAuthGuard`. O `JWT_SECRET` do gateway é o mesmo do users-service, products-service e checkout-service.
- `UsersModule` e `ProductsModule`: módulos de proxy que servem de **modelo** para esta spec (importam `ProxyModule` e `AuthModule`, repassam o `Authorization` e os dados do usuário autenticado ao `ProxyService` e protegem parâmetros de rota com o utilitário de segmento seguro já existente).
- Health check que consulta `GET {url}/health` de cada serviço configurado, inclusive `checkout`.
- Swagger em `/api`, já com a tag `Checkout` ("Endpoints para carrinho e pedidos") declarada.
- `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted`.

### 2.3 Lacunas identificadas no estado atual

| #  | Lacuna                                                                                                                                                                         | Tratada em |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| L1 | O gateway **não expõe nenhuma rota `/cart/*` ou `/orders/*`**. O `ProxyService` sabe falar com o serviço `checkout`, mas nenhum controller o usa; hoje `GET :3005/cart` responde 404. | RF-02, RF-03, RF-04 |
| L2 | O `.env.example` do gateway deixa `CHECKOUT_SERVICE_URL` vazio e a nota do `JWT_SECRET` não cita o checkout-service.                                                            | RF-01      |
| L3 | O README do gateway não documenta o fluxo de carrinho e pedidos, e não há teste E2E desse fluxo pelo gateway.                                                                   | RF-08, RF-09 |

Já está correto e só precisa ser **confirmado** (RF-01): o `.env` do gateway contém `CHECKOUT_SERVICE_URL=http://localhost:3003`, e o `JWT_SECRET` é o mesmo nos quatro serviços.

## 3. Escopo

### Dentro do escopo

- `CheckoutModule` no gateway com dois controllers de proxy: `CartProxyController` e `OrdersProxyController`.
- Exposição das seis rotas de carrinho e pedidos, encaminhadas pelo `ProxyService` existente ao serviço `checkout`.
- Proteção de todas essas rotas pelo `JwtAuthGuard` existente e repasse do header `Authorization` original.
- Registro do `CheckoutModule` no `AppModule`.
- Conferência e documentação das variáveis de ambiente.
- Documentação das rotas no Swagger do gateway (tag `Checkout`).
- Testes unitários dos dois controllers.
- Teste E2E do fluxo completo via gateway e passo a passo no README.

### Fora do escopo

- Qualquer alteração no `ProxyService`, `serviceConfig`, circuit breaker, retry, timeout, fallback, cache ou health check do gateway.
- Qualquer alteração na lógica do `JwtAuthGuard`, `JwtStrategy`, `SessionGuard` ou `RoleGuard`.
- Qualquer alteração no checkout-service (código, contratos, status, mensagens).
- Rotas de payments (`/payments/*`) e qualquer integração com o payments-service: ficam para outra spec.
- Atualização do status do pedido pelo resultado do pagamento.
- Autorização por role: seller e buyer usam as rotas da mesma forma (decisão P11 da spec 04 do checkout-service).
- Rota de teste `POST /test/send-message` do checkout-service: **não** é exposta pelo gateway.

---

## 4. Requisitos funcionais

### RF-01: Configuração de ambiente (verificação)

1. **RF-01.1** — O `.env` do gateway contém `CHECKOUT_SERVICE_URL=http://localhost:3003`. Já está correto; deve apenas ser confirmado.
2. **RF-01.2** — O `JWT_SECRET` do gateway é o **mesmo** do users-service, do products-service e do checkout-service. Já está correto; deve apenas ser confirmado, sem expor o valor.
3. **RF-01.3** — O `.env.example` do gateway passa a trazer `CHECKOUT_SERVICE_URL=http://localhost:3003` e a indicar que o `JWT_SECRET` precisa ser igual ao do users-service, do products-service **e** do checkout-service.
4. **RF-01.4** — `PAYMENT_SERVICE_URL` não é alterado por esta spec.
5. **RF-01.5** — Nenhum secret é versionado; os arquivos `.env` continuam ignorados pelo git.

### RF-02: `CheckoutModule`

1. **RF-02.1** — O gateway ganha um módulo próprio, `CheckoutModule`, que declara os dois controllers de proxy desta spec: `CartProxyController` e `OrdersProxyController`.
2. **RF-02.2** — O `CheckoutModule` segue a organização do `UsersModule` e do `ProductsModule`: importa o `ProxyModule` e o `AuthModule` **sem alterá-los** e não declara providers novos.
3. **RF-02.3** — O `CheckoutModule` é registrado no `AppModule` do gateway, ao lado do `UsersModule` e do `ProductsModule`. Nenhum outro import, provider ou guard do `AppModule` muda.
4. **RF-02.4** — Os artefatos ficam em uma pasta própria do domínio de checkout no `src/` do gateway, no mesmo padrão das pastas `users/` e `products/`.

### RF-03: `CartProxyController`

1. **RF-03.1** — Controller com prefixo **`cart`**, protegido **por inteiro** pelo `JwtAuthGuard` existente (guard declarado no nível do controller).
2. **RF-03.2** — Expõe as rotas abaixo e encaminha cada uma ao checkout-service pelo `ProxyService` (serviço `checkout`), mantendo método e caminho:

   | Rota no gateway (3005)          | Destino no checkout-service (3003) | Status de sucesso no gateway |
   | ------------------------------- | ---------------------------------- | ---------------------------- |
   | `POST /cart/items`              | `POST /cart/items`                 | 201                          |
   | `GET /cart`                     | `GET /cart`                        | 200                          |
   | `DELETE /cart/items/:itemId`    | `DELETE /cart/items/:itemId`       | 200                          |

3. **RF-03.3** — Em `POST /cart/items`, o corpo é encaminhado **sem alterações**: o gateway não valida, não remove e não acrescenta campos. A validação é do checkout-service, e o 400 dele (com a lista de mensagens) é repassado ao cliente.
4. **RF-03.4** — Em `DELETE /cart/items/:itemId`, o `itemId` é encaminhado de forma que um valor recebido do cliente **nunca** consiga alterar o caminho de destino (ex.: `..`, `/` ou `?` dentro do parâmetro), usando o mesmo utilitário de segmento seguro dos outros controllers de proxy.
5. **RF-03.5** — O gateway **não** valida o formato UUID do `itemId`. Essa validação é do checkout-service, e o 400 dele é repassado ao cliente.

### RF-04: `OrdersProxyController`

1. **RF-04.1** — Controller protegido **por inteiro** pelo `JwtAuthGuard` existente (guard declarado no nível do controller).
2. **RF-04.2** — Como as rotas atendem dois prefixos (`/cart/checkout` e `/orders`), o controller não depende de um prefixo único, no mesmo estilo do `UsersController` (que atende `/auth` e `/users`). A forma exata de declarar os caminhos fica para o plano, desde que as rotas finais sejam exatamente as da tabela abaixo.
3. **RF-04.3** — Expõe as rotas abaixo e encaminha cada uma ao checkout-service pelo `ProxyService` (serviço `checkout`), mantendo método e caminho:

   | Rota no gateway (3005)   | Destino no checkout-service (3003) | Status de sucesso no gateway |
   | ------------------------ | ---------------------------------- | ---------------------------- |
   | `POST /cart/checkout`    | `POST /cart/checkout`              | 201                          |
   | `GET /orders`            | `GET /orders`                      | 200                          |
   | `GET /orders/:id`        | `GET /orders/:id`                  | 200                          |

4. **RF-04.4** — Em `POST /cart/checkout`, o corpo é encaminhado **sem alterações** (mesma regra do RF-03.3). O `paymentMethod` é validado apenas pelo checkout-service.
5. **RF-04.5** — Em `GET /orders/:id`, o `id` segue a mesma regra de caminho seguro do RF-03.4 e não tem o formato validado no gateway (RF-03.5).
6. **RF-04.6** — `POST /cart/checkout` não pode conflitar com as rotas do `CartProxyController`: as duas classes coexistem sob `/cart` sem que uma rota encubra a outra.

### RF-05: Regras comuns de proxy (todas as seis rotas)

1. **RF-05.1** — Todas as chamadas passam pelo **`ProxyService` existente**, usando o nome de serviço `checkout`. Nenhum controller faz chamada HTTP direta ao checkout-service nem lê `CHECKOUT_SERVICE_URL`.
2. **RF-05.2** — Em caso de sucesso, o gateway devolve ao cliente o **mesmo corpo** retornado pelo checkout-service e o **mesmo status** da tabela da seção 2.1 (201 nos dois `POST`; 200 em `GET` e `DELETE`). Nenhum campo é renomeado, acrescentado ou removido; `price`, `subtotal` e `total` continuam números.
3. **RF-05.3** — Erros 4xx do checkout-service (400, 401, 404) chegam ao cliente com o mesmo status e a mesma mensagem. Isso já é feito pelo `ProxyService` e não deve ser reimplementado nos controllers.
4. **RF-05.4** — Quando o checkout-service está fora do ar, o cliente recebe **503** (fallback já configurado para `checkout`), nunca 401 nem 500.
5. **RF-05.5** — Mensagens de erro devolvidas ao cliente não expõem detalhes internos (URL do serviço, stack trace, objeto de erro do cliente HTTP).
6. **RF-05.6** — Os controllers não têm regra de negócio: só recebem a requisição, montam o caminho de destino e chamam o `ProxyService`.

### RF-06: Autenticação e repasse do `Authorization`

1. **RF-06.1** — As seis rotas são protegidas pelo **`JwtAuthGuard` existente** do gateway. Sem token, com token malformado, adulterado ou expirado, o gateway responde **401** **sem** chamar o checkout-service.
2. **RF-06.2** — Em **todas** as seis rotas, o header `Authorization` recebido pelo gateway é **repassado intacto** ao checkout-service, que também valida o token e usa o `sub` como dono do carrinho e dos pedidos.
3. **RF-06.3** — Em todas as seis rotas, os dados do usuário autenticado no gateway (`userId`, `email`, `role`) são passados ao `ProxyService`, que já os envia como headers `x-user-*`. O checkout-service continua usando o próprio JWT como fonte da identidade.
4. **RF-06.4** — Nenhuma rota é pública e nenhuma usa `RoleGuard` ou `SessionGuard`. Seller e buyer têm o mesmo acesso.
5. **RF-06.5** — A lógica do `JwtAuthGuard` e da `JwtStrategy` não é alterada.

### RF-07: Swagger do gateway

1. **RF-07.1** — As seis rotas aparecem no Swagger do gateway (`/api`), na tag **`Checkout`** já existente.
2. **RF-07.2** — Todas aparecem marcadas como exigindo Bearer Auth (esquema `JWT-auth` já configurado).
3. **RF-07.3** — Cada rota documenta os status que o cliente pode receber pelo gateway: os da tabela da seção 2.1 mais o **503** (checkout-service indisponível). Em todas, o 401 pode vir do gateway ou do checkout-service.
4. **RF-07.4** — Os corpos de `POST /cart/items` (`productId`, `quantity`) e `POST /cart/checkout` (`paymentMethod` com os quatro valores aceitos) aparecem documentados apenas para fins de documentação. Essa documentação **não** pode fazer o `ValidationPipe` global do gateway rejeitar ou remover campos do corpo (ver RF-03.3 e a seção 8).
5. **RF-07.5** — Os parâmetros `:itemId` e `:id` aparecem documentados como UUID.

### RF-08: Teste E2E do fluxo completo via gateway

1. **RF-08.1** — Existe um teste E2E automatizado no api-gateway que percorre o fluxo do RF-08.3 **somente por requisições HTTP ao gateway**, com users-service, products-service, checkout-service, bancos e RabbitMQ reais no ar.
2. **RF-08.2** — Esse teste não quebra o `test:e2e` padrão do gateway quando os serviços não estão no ar: ele roda por comando dedicado ou é habilitado explicitamente (a forma fica para o plano), e os pré-requisitos ficam documentados no README.
3. **RF-08.3** — Passos e verificações do fluxo:
   1. **Preparação**: registro (ou reaproveitamento) de um `seller` e criação de um produto ativo via `POST :3005/products`, para ter um `productId` válido. Registro (ou reaproveitamento) de um usuário comprador.
   2. **Login**: `POST :3005/auth/login` do comprador → 200 com `token`.
   3. **Adicionar ao carrinho**: `POST :3005/cart/items` com o `productId` do passo 1 e `quantity` ≥ 1 → 201 com o carrinho contendo o item, `productName` e `price` copiados do produto e `total` coerente.
   4. **Ver carrinho**: `GET :3005/cart` → 200 com o mesmo carrinho do passo 3 (`status` `active`).
   5. **Finalizar**: `POST :3005/cart/checkout` com um `paymentMethod` válido → 201 com o pedido `pending`, os mesmos itens e o mesmo `total` do carrinho.
   6. **Ver pedidos**: `GET :3005/orders` → 200 com um array que contém o pedido do passo 5; `GET :3005/orders/<id do passo 5>` → 200 com o mesmo pedido.
   7. **Carrinho após o checkout**: `GET :3005/cart` → 200 com carrinho vazio (`id` nulo, sem itens).
4. **RF-08.4** — O teste também cobre, pelo gateway: uma rota de carrinho sem token → 401; `DELETE :3005/cart/items/:itemId` de um item adicionado → 200 com o item removido; `GET :3005/orders/<uuid aleatório>` → 404.
5. **RF-08.5** — O teste é repetível: pode ser executado várias vezes seguidas sem limpeza manual dos bancos (ex.: usa e-mails únicos por execução ou reaproveita usuários de forma determinística).

### RF-09: README do gateway

1. **RF-09.1** — O README ganha a seção **"Fluxo E2E com checkout-service"**, no mesmo formato das seções de users-service e products-service: pré-requisitos (serviços, bancos, RabbitMQ, variáveis de ambiente), passo a passo com comandos curl somente pela porta 3005 e a seção de health e documentação.
2. **RF-09.2** — O passo a passo cobre o fluxo do RF-08.3 e explica como rodar o teste E2E automatizado do RF-08.

---

## 5. Fluxo esperado (via gateway, porta 3005)

Cliente → api-gateway :3005 → users-service :3000 / products-service :3001 / checkout-service :3003

1. **Login** — `POST /auth/login` (público). O gateway chama o users-service, que responde **200** com `user` e `token`.
2. **Adicionar ao carrinho** — `POST /cart/items` com `Authorization: Bearer <token>`.
   1. O `JwtAuthGuard` do gateway valida o token. Se o token for inválido, responde **401** e o checkout-service não é chamado.
   2. Se o token for válido, o `ProxyService` encaminha o corpo intacto, o `Authorization` original e os headers `x-user-*` para `POST /cart/items` no checkout-service.
   3. O checkout-service valida o token e o corpo, consulta o produto no products-service e grava o item.
   4. O gateway devolve **201** com o carrinho atualizado, sem transformação.
3. **Ver carrinho** — `GET /cart` com o mesmo token. O gateway encaminha e devolve **200** com o carrinho ativo.
4. **Remover item (opcional)** — `DELETE /cart/items/:itemId`. O gateway encaminha e devolve **200** com o carrinho atualizado, **400** para `itemId` que não é UUID ou **404** para item fora do carrinho.
5. **Finalizar** — `POST /cart/checkout` com `paymentMethod`. O gateway encaminha e devolve **201** com o pedido `pending`. O checkout-service publica a mensagem de pagamento no RabbitMQ; o gateway não participa disso.
6. **Ver pedidos** — `GET /orders` e `GET /orders/:id`. O gateway encaminha e devolve **200** com a lista ou o pedido, **400** para `id` que não é UUID ou **404** para pedido inexistente ou de outro usuário.

## 6. Respostas esperadas (via gateway)

| Rota no gateway                 | Cenário                                                       | Status esperado                                      |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Qualquer uma das seis rotas     | Sem token, token malformado, adulterado ou expirado           | 401, respondido pelo gateway                         |
| Qualquer uma das seis rotas     | checkout-service fora do ar                                   | 503, nunca 401 nem 500                               |
| `POST /cart/items`              | Token válido, produto ativo e `quantity` válida               | 201 + carrinho atualizado                            |
| `POST /cart/items`              | Corpo inválido ou com campo extra                             | 400 + lista de mensagens do checkout-service         |
| `POST /cart/items`              | `productId` de produto inexistente                            | 404, vindo do checkout-service                       |
| `POST /cart/items`              | Produto inativo                                               | 400, vindo do checkout-service                       |
| `GET /cart`                     | Usuário com carrinho ativo                                    | 200 + carrinho                                       |
| `GET /cart`                     | Usuário sem carrinho ativo                                    | 200 + carrinho vazio (`id` nulo, sem itens)          |
| `DELETE /cart/items/:itemId`    | Item do carrinho ativo do usuário                             | 200 + carrinho atualizado                            |
| `DELETE /cart/items/:itemId`    | `itemId` não é UUID                                           | 400                                                  |
| `DELETE /cart/items/:itemId`    | Item de outro usuário ou inexistente                          | 404                                                  |
| `POST /cart/checkout`           | Carrinho com itens e `paymentMethod` válido                   | 201 + pedido `pending`                               |
| `POST /cart/checkout`           | Carrinho vazio ou inexistente                                 | 400                                                  |
| `POST /cart/checkout`           | `paymentMethod` ausente ou inválido                           | 400 + mensagem do checkout-service                   |
| `GET /orders`                   | Token válido                                                  | 200 + array (pode ser `[]`)                          |
| `GET /orders/:id`               | Pedido do usuário                                             | 200 + pedido                                         |
| `GET /orders/:id`               | `id` não é UUID                                               | 400                                                  |
| `GET /orders/:id`               | Pedido inexistente ou de outro usuário                        | 404                                                  |
| `GET /health` (gateway)         | checkout-service no ar                                        | `checkout` = healthy                                 |
| `GET /health` (gateway)         | checkout-service fora do ar                                   | `checkout` = unhealthy, geral = degraded             |

## 7. Requisitos não funcionais

- **RNF-01** — O gateway não ganha dependências novas.
- **RNF-02** — `ProxyService`, `serviceConfig`, `JwtAuthGuard`, `JwtStrategy`, `SessionGuard`, `RoleGuard` e os módulos de circuit breaker, retry, timeout, fallback, cache e health check não têm a lógica alterada.
- **RNF-03** — O checkout-service não é alterado.
- **RNF-04** — O `JWT_SECRET` vem exclusivamente de variável de ambiente.
- **RNF-05** — Os novos artefatos seguem a organização de pastas do gateway: o `CheckoutModule` espelha o `UsersModule` e o `ProductsModule`.
- **RNF-06** — Comentários curtos em português, como no restante do código.

### Estrutura de pastas esperada (alto nível)

- **api-gateway**
  - `docs/specs/01-integracao-do-checkout-service.md` (esta spec)
  - `.env.example`: `CHECKOUT_SERVICE_URL` e nota sobre o `JWT_SECRET`
  - `src/checkout/`: `CheckoutModule`, `CartProxyController` e `OrdersProxyController`, com testes unitários
  - `src/app.module`: registra o `CheckoutModule`
  - `test/`: teste E2E do fluxo de carrinho e pedidos
  - `README.md`: passo a passo do fluxo E2E de checkout

## 8. Pontos de atenção

Os pontos abaixo ficam fora do escopo porque o `ProxyService` e o checkout-service não podem ser alterados. Devem ser registrados para specs futuras do gateway.

- **Retry em `POST` não idempotente:** o `ProxyService` refaz a chamada em timeout e erros 5xx (até 5 tentativas). Se o checkout-service demorar mais que o timeout (10 s) mas concluir a operação, a nova tentativa pode somar a mesma quantidade de novo em `POST /cart/items` ou, em `POST /cart/checkout`, encontrar o carrinho já finalizado e devolver **400** ao cliente mesmo com o pedido criado. Em uso normal (respostas rápidas) isso não acontece.
- **503 do products-service visto como falha do checkout:** quando o products-service está fora, `POST /cart/items` responde 503 no checkout-service. O gateway trata esse 5xx como falha do serviço `checkout`: faz retry, conta falha no circuit breaker `proxy-checkout` e responde com a mensagem de fallback do checkout (não com `Serviço de produtos indisponível`). Após 3 falhas, o circuito abre e **todas** as rotas de checkout respondem 503 por cerca de 30 s, mesmo com o checkout-service saudável. Por isso os critérios de aceite exigem apenas **503** nesse cenário, sem fixar a mensagem.
- **Tempo de resposta com o serviço fora:** com o checkout-service parado, retry com backoff pode fazer o cliente esperar vários segundos antes do 503.
- **Cache de `GET` sem usuário na chave:** o `ProxyService` grava a resposta de todo `GET` bem-sucedido com a chave `checkout-<caminho>` (ex.: `checkout-/cart`, `checkout-/orders`), sem distinguir o usuário. Hoje o fallback de `checkout` não lê esse cache (é fallback de erro), então não há vazamento. Se no futuro o fallback de checkout passar a usar cache, dados de um usuário poderão ser devolvidos a outro.
- **ValidationPipe global do gateway:** ele usa `whitelist` e `forbidNonWhitelisted`. Se o corpo de `POST /cart/items` ou `POST /cart/checkout` for tipado no gateway com uma classe sem regras de validação, todos os campos podem ser rejeitados (400) ou removidos antes de chegar ao checkout-service. O plano deve garantir o RF-03.3, o RF-04.4 e o RF-07.4.
- **Status de sucesso definido pelo gateway:** o `ProxyService` devolve apenas o corpo da resposta, não o status. O status de sucesso visto pelo cliente é o declarado em cada rota do gateway e precisa bater com o do checkout-service (RF-05.2).
- **401 em dois lugares:** o gateway barra tokens inválidos antes de chamar o checkout-service. Se os `JWT_SECRET` divergirem no futuro, o gateway aceitaria um token que o checkout-service rejeitaria (ou o contrário). Manter o `.env.example` claro (RF-01.3) reduz esse risco.
- **RabbitMQ fora do ar:** pela decisão P4 da spec 04 do checkout-service, o checkout continua respondendo 201 e o pedido fica `pending`. O gateway apenas repassa essa resposta.
- **Throttle global:** o `CustomThrottlerGuard` do gateway limita requisições por IP (inclusive `POST /auth/login` e `POST /auth/register`, com limites mais baixos). O teste E2E e os testes manuais em sequência devem respeitar esses limites.

## 9. Critérios de aceite

### Configuração e estrutura

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-01 | `.env` contém `CHECKOUT_SERVICE_URL=http://localhost:3003`; `.env.example` traz o mesmo valor e a nota de que o `JWT_SECRET` é compartilhado com users-service, products-service e checkout-service. | Revisão dos arquivos.                            |
| CA-02 | Existe o `CheckoutModule` com `CartProxyController` e `OrdersProxyController`, importando `ProxyModule` e `AuthModule`, registrado no `AppModule`.               | Revisão do código.                               |
| CA-03 | Ao iniciar o gateway, os logs mostram as seis rotas: `POST /cart/items`, `GET /cart`, `DELETE /cart/items/:itemId`, `POST /cart/checkout`, `GET /orders` e `GET /orders/:id`. | Logs de inicialização.                           |
| CA-04 | Não há alterações em `ProxyService`, `serviceConfig`, guards, `JwtStrategy`, circuit breaker, retry, timeout, fallback, cache e health check do gateway, nem no checkout-service. | `git diff` do gateway e do checkout-service.     |
| CA-05 | Não existe nenhuma rota `/payments/*` nem `/test/send-message` no gateway.                                                                                      | Logs de inicialização e Swagger.                 |

### Autenticação e repasse

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-06 | Cada uma das seis rotas, sem token → **401**, e os logs do checkout-service mostram que nenhuma requisição chegou a ele.                                        | curl + logs.                                     |
| CA-07 | Cada uma das seis rotas, com token adulterado ou expirado → **401** respondido pelo gateway.                                                                   | curl.                                            |
| CA-08 | Nas seis rotas, o checkout-service recebe o header `Authorization` original e o `ProxyService` recebe os dados do usuário autenticado.                         | Testes unitários dos controllers.                |
| CA-09 | Nas seis rotas, o `ProxyService` é chamado com o serviço `checkout`, o método e o caminho corretos.                                                            | Testes unitários dos controllers.                |
| CA-10 | Seller e buyer conseguem usar as seis rotas pelo gateway.                                                                                                      | curl com tokens dos dois roles.                  |

### Comportamento das rotas

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-11 | `POST :3005/cart/items` válido → **201** com o mesmo formato de carrinho que a chamada direta à porta 3003.                                                     | Comparar as duas respostas.                      |
| CA-12 | `POST :3005/cart/items` com corpo inválido ou campo extra → **400** com a **mesma** lista de mensagens que a chamada direta à porta 3003.                       | Comparar as duas respostas.                      |
| CA-13 | `POST :3005/cart/items` e `POST :3005/cart/checkout` encaminham o corpo intacto (sem campos removidos ou acrescentados).                                        | Testes unitários dos controllers.                |
| CA-14 | `POST :3005/cart/items` com `productId` inexistente → **404** com a mensagem do checkout-service.                                                               | curl.                                            |
| CA-15 | `GET :3005/cart` → **200** com o mesmo corpo de `GET :3003/cart` para o mesmo token.                                                                          | Comparar as duas respostas.                      |
| CA-16 | `DELETE :3005/cart/items/<itemId>` de um item do carrinho → **200** com o carrinho sem o item; `DELETE :3005/cart/items/abc` → **400**; com UUID aleatório → **404**. | curl.                                            |
| CA-17 | `POST :3005/cart/checkout` com carrinho vazio → **400**; com `paymentMethod` inválido → **400** com a mensagem do checkout-service.                             | curl.                                            |
| CA-18 | `GET :3005/orders/abc` → **400**; `GET :3005/orders/<uuid aleatório>` → **404**; `GET :3005/orders/<id de pedido de outro usuário>` → **404**.                  | curl.                                            |
| CA-19 | Um `itemId` ou `id` com `..` ou `/` codificado não faz o gateway chamar outro caminho do checkout-service.                                                     | Testes unitários dos controllers.                |
| CA-20 | Com o checkout-service parado, cada uma das seis rotas com token válido → **503** (não 401 nem 500), sem URL interna ou stack trace no corpo.                  | Parar o serviço e chamar as rotas.               |
| CA-21 | Com o products-service parado, `POST :3005/cart/items` com token válido → **503**.                                                                            | Parar o products-service e chamar a rota.        |
| CA-22 | `GET :3005/health` mostra `checkout` como healthy com o serviço no ar, e `checkout` unhealthy com status geral degraded com o serviço parado.                     | curl.                                            |

### Swagger

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-23 | O Swagger do gateway (`:3005/api`) lista as seis rotas na tag `Checkout`, todas com cadeado (Bearer).                                                         | Navegador.                                       |
| CA-24 | Os corpos de `POST /cart/items` e `POST /cart/checkout` aparecem documentados (incluindo os quatro valores de `paymentMethod`), e `:itemId`/`:id` como UUID.    | Navegador.                                       |
| CA-25 | Cada rota mostra os códigos de resposta do RF-07.3.                                                                                                            | Navegador.                                       |
| CA-26 | Pelo Swagger, com um token no "Authorize", é possível adicionar um item, finalizar o carrinho e ver o pedido.                                                 | Navegador.                                       |

### Fluxo E2E (somente pela porta 3005)

Com users-service, products-service, checkout-service, bancos, RabbitMQ e o gateway no ar:

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-27 | `POST :3005/auth/login` de um usuário existente → **200** com `token`.                                                                                         | Teste E2E / curl.                                |
| CA-28 | `POST :3005/cart/items` com esse token e um produto ativo → **201** com o item no carrinho, `productName` e `price` do produto e `total` = soma dos `subtotal`. | Teste E2E / curl.                                |
| CA-29 | `GET :3005/cart` → **200** com o carrinho do CA-28, `status` `active`.                                                                                         | Teste E2E / curl.                                |
| CA-30 | `POST :3005/cart/checkout` com `paymentMethod` válido → **201** com pedido `pending`, os mesmos itens e o mesmo `total` do CA-29.                                | Teste E2E / curl.                                |
| CA-31 | `GET :3005/orders` → **200** com array que contém o pedido do CA-30; `GET :3005/orders/<id do CA-30>` → **200** com o mesmo pedido.                             | Teste E2E / curl.                                |
| CA-32 | `GET :3005/cart` após o checkout → **200** com carrinho vazio (`id` nulo, sem itens).                                                                          | Teste E2E / curl.                                |
| CA-33 | O teste E2E automatizado (RF-08) passa com os serviços no ar e pode ser executado duas vezes seguidas sem limpeza manual.                                       | Rodar o comando do teste E2E duas vezes.         |
| CA-34 | Sem os serviços no ar, o `test:e2e` padrão do gateway continua passando (o teste do fluxo não é executado).                                                     | `pnpm run test:e2e`.                             |
| CA-35 | O passo a passo de CA-27 a CA-32 (comandos curl) e a forma de rodar o teste E2E estão documentados no README do gateway, junto dos fluxos de users e products.  | Revisão do README.                               |

### Qualidade

| #     | Critério                                                                                                                                                       | Como verificar                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CA-36 | Testes unitários do `CartProxyController` e do `OrdersProxyController` cobrem: serviço `checkout`, método e caminho corretos, corpo intacto nos `POST`, repasse do `Authorization` e dos dados do usuário em todas as rotas, e caminho seguro com parâmetro malicioso. | `pnpm run test`.                                 |
| CA-37 | `build`, `lint` e `test` passam sem erros no gateway, e os testes existentes continuam passando sem mudar as asserções.                                         | Rodar os comandos.                               |

## 10. Commits

Faça sempre um commit final após a finalização dessa spec.

- O api-gateway é um **repositório git próprio**: todos os commits desta spec vão nele. O checkout-service não recebe commits.
- Cada etapa gera um **commit separado**. Sugestão:
  1. `.env.example` com `CHECKOUT_SERVICE_URL` e nota do `JWT_SECRET`.
  2. `CheckoutModule` e `CartProxyController` com as rotas `/cart/*`.
  3. `OrdersProxyController` com `POST /cart/checkout` e `/orders/*`, e registro do módulo no `AppModule`.
  4. Testes unitários dos dois controllers.
  5. Teste E2E do fluxo de carrinho e pedidos.
  6. README com o fluxo E2E de checkout.
- Antes de cada commit, rodar o lint do gateway e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico do repositório (ex.: `chore: ...`, `feat(checkout): ...`, `test(checkout): ...`, `docs: ...`), em português e descrevendo a etapa de forma objetiva.
