# SPEC: Finalização do pedido no checkout-service

| Campo        | Valor                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Serviço      | checkout-service                                                                        |
| Sistema      | marketplace-ms                                                                          |
| Tipo         | Regra de negócio / mensageria (RabbitMQ) / API REST                                     |
| Status       | Pronta para planejamento                                                                |
| Data         | 2026-10-14                                                                              |
| Depende de   | `02-entidades-e-validacao-de-jwt.md`, `03-gerenciamento-do-carrinho.md` (checkout-service) |

---

## 1. Objetivo

Permitir que o usuário autenticado (seller ou buyer) finalize o carrinho e acompanhe os próprios pedidos no checkout-service (porta 3003):

1. Expor três rotas protegidas:
   - `POST /cart/checkout`: finaliza o carrinho ativo, cria o pedido e solicita o pagamento;
   - `GET /orders`: lista os pedidos do usuário;
   - `GET /orders/:id`: mostra um pedido do usuário.
2. Transformar o carrinho ativo em um `Order` com status `pending`, copiando os itens para `OrderItem`.
3. Publicar uma `PaymentOrderMessage` no RabbitMQ para que o payments-service processe o pagamento depois, de forma **assíncrona**.

Ao final desta spec, o usuário consegue fechar a compra e consultar os pedidos. O pedido fica `pending`: **nenhum** pagamento é processado pelo checkout-service, e o status do pedido ainda **não** é atualizado pelo resultado do pagamento.

## 2. Ponto de partida

### 2.1 O que já existe

- Carrinho funcional (spec 03): `GET /cart`, `POST /cart/items` e `DELETE /cart/items/:itemId`, com `CartService`, `CartController` e o índice único parcial que permite **um** carrinho `active` por usuário. O `CartModule` hoje **não exporta** nenhum provider.
- `CartStatus` com `active`, `completed` e `abandoned`.
- Entidades `Order` (`orders`) e `OrderItem` (`order_items`), criadas na spec 02:
  - `Order`: `id`, `userId`, `cartId` (só a referência, sem relação), `total` decimal(10,2), `status` (`OrderStatus`, padrão `pending`), `paymentMethod` varchar(50), `items` (cascade e eager), `createdAt` e `updatedAt`.
  - `OrderItem`: `id`, `orderId`, `productId`, `productName`, `price`, `quantity`, `subtotal` e `createdAt`.
- `OrderStatus` com `pending`, `paid`, `failed` e `cancelled`.
- `OrdersModule` em `src/orders/`, que só registra os repositórios de `Order` e `OrderItem`. Não tem controller nem service.
- Mapper `toPaymentOrderMessage`, que monta a `PaymentOrderMessage` a partir de um `Order` com os itens carregados, com testes unitários e e2e.
- `EventsModule`, que exporta `RabbitmqService` e `PaymentQueueService`. O `PaymentQueueService` tem:
  - `publishPaymentOrder`: publica no exchange `payments` com a routing key `payment.order`, completando `createdAt` e `metadata`;
  - `publishPaymentOrderSafe`: valida a mensagem (ids, `amount` > 0, `paymentMethod`, itens válidos e `amount` igual à soma dos itens) e só então publica.
- Utilitários de dinheiro em `src/common/utils/money` (soma em centavos, limite do decimal(10,2)).
- `JwtAuthGuard` global, `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`, e Swagger em `/api` com as tags `Health` e `Cart`.
- `AppModule` já registra `CartModule`, `OrdersModule` e `EventsModule`.

### 2.2 Contrato com o payments-service

| Item                  | Valor                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Exchange              | `payments` (tipo topic, durável)                                                                   |
| Routing key           | `payment.order`                                                                                    |
| Queue consumida       | `payment_queue`, declarada e ligada ao exchange **pelo payments-service** quando ele sobe          |
| Mensagem              | `PaymentOrderMessage`: `orderId`, `userId`, `amount`, `items[]` (`productId`, `quantity`, `price`), `paymentMethod`, `description?`, `createdAt?` |
| Validação no consumidor | Rejeita mensagem sem `orderId`, sem `userId`, com `amount` ≤ 0, sem `paymentMethod` ou sem itens |

O checkout-service **só publica**. Ele não consome nenhuma fila nesta spec.

### 2.3 Diagnóstico do pedido x código atual

| #  | Pedido / suposição                                                         | Estado real no código                                                                                                         | Decisão                                                                                                                                  |
| -- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | O pedido é criado com `userId`, `cartId`, `total`, `paymentMethod` e `status`. | `Order` tem a relação `items` com `OrderItem`, e o mapper `toPaymentOrderMessage` monta os itens da mensagem a partir de `order.items`. | O checkout **também** cria um `OrderItem` para cada item do carrinho (RN-04). Sem isso, a mensagem sai sem itens e o payments-service a rejeita. |
| D2 | `paymentMethod` aceita `credit_card`, `debit_card`, `pix` ou `boleto`.      | Não existe enum de forma de pagamento. A coluna `orders.paymentMethod` é texto livre.                                         | Criar o enum `PaymentMethod` com os quatro valores e usá-lo na validação da entrada e na tipagem da propriedade `Order.paymentMethod`. A coluna continua varchar(50): **nenhuma** mudança de schema. |
| D3 | Publicar a mensagem no RabbitMQ faz parte do checkout.                      | `RabbitmqService.publishMessage` **não lança erro**: sem canal ele só registra um aviso, e falhas de publicação são apenas logadas. | A publicação nunca desfaz o pedido. O pedido é gravado antes da publicação, e uma falha na publicação não muda a resposta (P4).          |
| D4 | Usar `publishPaymentOrder`.                                                 | Existe também `publishPaymentOrderSafe`, que valida a mensagem antes de publicar.                                             | Usar `publishPaymentOrderSafe`. Uma mensagem inválida não chega à fila e fica registrada no log (P4).                                    |
| D5 | `POST /cart/checkout` está sob o prefixo `/cart`.                            | O `OrdersModule` vai importar o `CartModule`. Se o `CartController` criasse pedidos, o `CartModule` teria que importar o `OrdersModule`, gerando dependência circular. | A rota `POST /cart/checkout` é declarada **no `OrdersModule`**, não no `CartController`. O `CartModule` não importa o `OrdersModule`. |
| D6 | `OrdersModule` importa o `CartModule`.                                       | O `CartModule` não exporta nada.                                                                                              | O `CartModule` passa a exportar o `CartService` (RF-08.2).                                                                               |

### 2.4 Decisões de projeto

Pontos que o pedido não define e que esta spec decide:

| #   | Questão                                                                  | Decisão                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Usuário sem carrinho ativo tenta finalizar.                              | Mesmo tratamento do carrinho vazio: **400** `Carrinho vazio`.                                                                                                   |
| P2  | O que é gravado primeiro: pedido ou mensagem?                            | Pedido, itens do pedido e status do carrinho são gravados em **uma** transação. A mensagem só é publicada **depois** que a transação foi confirmada.             |
| P3  | O checkout revalida preço, status ou estoque no products-service?         | **Não**. O pedido usa o snapshot gravado no carrinho (spec 03, RN-04). O checkout **não** chama o products-service.                                              |
| P4  | O que acontece se a publicação falhar (RabbitMQ fora, mensagem inválida)? | O pedido continua gravado com status `pending`, o carrinho continua `completed` e a rota responde **201** normalmente. A falha é registrada no log com o `orderId`. Não há retry nem reenvio nesta spec. |
| P5  | Dois checkouts simultâneos do mesmo usuário.                             | Só **um** pedido é criado. Uma requisição responde **201**; a outra responde **400** `Carrinho vazio`. Nenhuma responde 500.                                     |
| P6  | Pedido de outro usuário em `GET /orders/:id`.                            | **404**, igual a um pedido inexistente. A resposta não revela que o pedido existe.                                                                             |
| P7  | `GET /orders` sem pedidos.                                               | **200** com lista vazia.                                                                                                                                        |
| P8  | Paginação em `GET /orders`.                                              | **Não** nesta spec. A rota devolve todos os pedidos do usuário.                                                                                                |
| P9  | `description` da mensagem.                                               | Não é enviado. O mapper `toPaymentOrderMessage` continua igual.                                                                                                 |
| P10 | O carrinho finalizado aparece em `GET /cart`?                            | **Não**. Depois do checkout, `GET /cart` responde o carrinho vazio, e a próxima adição de item cria um **novo** carrinho `active`.                                |
| P11 | Seller pode finalizar a compra?                                          | **Sim**. Seller e buyer usam as rotas da mesma forma, sem restrição por role.                                                                                  |
| P12 | Em qual tag do Swagger ficam as rotas?                                   | As três rotas ficam na nova tag `Orders`.                                                                                                                       |

## 3. Escopo

### Dentro do escopo

- Enum `PaymentMethod` e DTO de entrada do `POST /cart/checkout`.
- `OrdersService` com a finalização do carrinho, a listagem e o detalhe de pedidos.
- Controller(s) do `OrdersModule` com as três rotas.
- Formato de resposta do pedido.
- Operação do `CartService` para obter e finalizar o carrinho ativo dentro da transação do checkout.
- Exportação do `CartService` pelo `CartModule`.
- `OrdersModule` importando `CartModule` e `EventsModule`.
- Publicação da `PaymentOrderMessage` com o `PaymentQueueService` existente.
- Documentação das rotas no Swagger (tag `Orders`).
- Tipagem explícita de todo o código da spec (RNF-01).
- Testes unitários e e2e.

### Fora do escopo

- Processamento do pagamento. É responsabilidade do payments-service.
- Atualizar o status do pedido para `paid`, `failed` ou `cancelled`, e consumir qualquer resposta do payments-service.
- Cancelamento de pedido (ex.: `DELETE /orders/:id` ou `PATCH /orders/:id/cancel`).
- Verificação, reserva ou baixa de estoque.
- Revalidação de preço ou de status do produto no products-service (P3).
- Retry, outbox ou reenvio de mensagens que falharam (P4).
- Paginação, filtros e ordenações alternativas em `GET /orders` (P8).
- Mudança de carrinho para `abandoned`.
- Mudança no schema do banco (colunas, tipos, índices).
- Qualquer alteração em `src/events/`, `src/auth/`, `src/health/` e `src/products-client/`, incluindo `PaymentOrderMessage`, `PaymentQueueService` e `RabbitmqService`.
- Alteração no mapper `toPaymentOrderMessage`.
- Integração das rotas com o api-gateway.
- Alterações no users-service, no products-service, no payments-service e no api-gateway.

---

## 4. Regras de negócio

- **RN-01: Posse.** O dono do pedido é **sempre** o `req.user.id`. Nenhuma rota recebe `userId`, `cartId`, `total` ou itens do cliente. O usuário só finaliza o próprio carrinho ativo e só lê os próprios pedidos.
- **RN-02: Carrinho finalizável.** Só pode ser finalizado o carrinho `active` do usuário que tem **pelo menos um** item.
- **RN-03: Pedido.** O pedido criado tem: `userId` do usuário autenticado, `cartId` do carrinho finalizado, `total` do carrinho, `paymentMethod` recebido e `status` `pending`.
- **RN-04: Itens do pedido.** Cada item do carrinho vira **um** `OrderItem` com os mesmos `productId`, `productName`, `price`, `quantity` e `subtotal`. Depois disso, mudanças no carrinho ou no products-service **não** alteram o pedido.
- **RN-05: Total.** O `total` do pedido é igual ao `total` do carrinho e igual à soma dos `subtotal` dos itens do pedido, com 2 casas decimais e sem erro de ponto flutuante.
- **RN-06: Carrinho concluído.** Ao criar o pedido, o carrinho passa de `active` para `completed`. Os itens e o total do carrinho **não** são apagados nem alterados.
- **RN-07: Atomicidade.** Criação do pedido, criação dos itens do pedido e mudança do carrinho para `completed` acontecem juntas: se qualquer passo falhar, nenhuma dessas mudanças fica gravada.
- **RN-08: Um pedido por carrinho.** Um carrinho gera **no máximo um** pedido, inclusive com requisições simultâneas (P5).
- **RN-09: Pagamento assíncrono.** Depois de gravado o pedido, o checkout publica **uma** `PaymentOrderMessage` com `orderId`, `userId`, `amount` (= `total` do pedido), `items` (`productId`, `quantity`, `price` de cada item do pedido), `paymentMethod` e `createdAt` do pedido. O checkout **não** espera o processamento do pagamento para responder.
- **RN-10: Publicação não desfaz o pedido.** Falha na publicação não remove o pedido nem reabre o carrinho (P4).

## 5. Requisitos funcionais: entrada e formato de resposta

### RF-01: Forma de pagamento

1. **RF-01.1**: existe o enum `PaymentMethod` no domínio de pedidos com os valores `credit_card`, `debit_card`, `pix` e `boleto`.
2. **RF-01.2**: a propriedade `Order.paymentMethod` é tipada com esse enum. A coluna no banco continua varchar(50), sem mudança de schema.

### RF-02: Corpo do `POST /cart/checkout`

| Campo           | Obrigatório | Regra                                                   | Mensagem de erro (400)                                                       |
| --------------- | ----------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `paymentMethod` | sim         | Um dos valores do enum `PaymentMethod`, exatamente em minúsculas | `paymentMethod deve ser um dos valores: credit_card, debit_card, pix, boleto` |

1. **RF-02.1**: qualquer outro campo no corpo (ex.: `userId`, `cartId`, `total`, `status`, `items`) é rejeitado com **400** pelo `ValidationPipe` global (RN-01).
2. **RF-02.2**: o DTO é documentado no Swagger com os valores aceitos e um exemplo.

### RF-03: Formato da resposta do pedido

As três rotas devolvem pedidos no mesmo formato. `POST /cart/checkout` e `GET /orders/:id` devolvem um pedido; `GET /orders` devolve uma lista de pedidos.

| Campo           | Tipo           | Descrição                                                        |
| --------------- | -------------- | ---------------------------------------------------------------- |
| `id`            | uuid           | Identificador do pedido. É o `orderId` da mensagem de pagamento. |
| `userId`        | uuid           | Sempre o `req.user.id`.                                          |
| `cartId`        | uuid           | Carrinho que originou o pedido.                                  |
| `total`         | número         | RN-05. Número, não texto.                                        |
| `status`        | texto          | Valor de `OrderStatus`. Sempre `pending` nesta spec.             |
| `paymentMethod` | texto          | Valor de `PaymentMethod`.                                        |
| `items`         | lista          | Itens do pedido.                                                 |
| `createdAt`     | data ISO 8601  | Momento da criação do pedido.                                    |
| `updatedAt`     | data ISO 8601  | Última atualização do pedido.                                    |

Cada item de `items`:

| Campo         | Tipo          | Descrição                                   |
| ------------- | ------------- | ------------------------------------------- |
| `id`          | uuid          | Identificador do item do pedido.            |
| `productId`   | uuid          | Produto do products-service.                |
| `productName` | texto         | Copiado do item do carrinho (RN-04).        |
| `price`       | número        | Preço unitário copiado do carrinho.         |
| `quantity`    | inteiro       | ≥ 1.                                        |
| `subtotal`    | número        | `price × quantity`, copiado do carrinho.    |
| `createdAt`   | data ISO 8601 | Momento da criação do item do pedido.       |

1. **RF-03.1**: os itens **não** trazem `order` nem `orderId`. O pedido **não** traz campos além dos listados.
2. **RF-03.2**: `total`, `price` e `subtotal` são números, nunca texto.
3. **RF-03.3**: a ordem dos itens dentro do pedido não faz parte do contrato. Os testes comparam os itens sem depender da ordem.
4. **RF-03.4**: o formato é documentado no Swagger.

## 6. Requisitos funcionais: rotas

### RF-04: `POST /cart/checkout`

1. **RF-04.1**: rota **protegida** (sem `@Public()`), declarada no `OrdersModule` (D5).
2. **RF-04.2**: fluxo:
   1. valida o corpo (RF-02). Se for inválido → **400**, sem tocar no banco e sem publicar nada;
   2. dentro de uma transação, obtém o carrinho `active` do usuário **com bloqueio**, de forma que outro checkout simultâneo do mesmo usuário espere ou não encontre o carrinho (RN-08);
   3. se não existir carrinho ativo, ou se ele não tiver itens → **400** `Carrinho vazio`, sem gravar nada;
   4. cria o `Order` (RN-03) e um `OrderItem` para cada item do carrinho (RN-04), com `total` conforme RN-05;
   5. muda o status do carrinho para `completed` (RN-06);
   6. confirma a transação (RN-07);
   7. monta a mensagem com `toPaymentOrderMessage` a partir do pedido gravado, com os itens carregados, e publica com `PaymentQueueService.publishPaymentOrderSafe` (RN-09);
   8. responde **201** com o pedido criado no formato da RF-03.
3. **RF-04.3**: se a publicação do passo 7 falhar, por qualquer motivo, o erro é registrado no log do checkout-service com o `orderId` e o motivo, e a resposta continua sendo **201** com o pedido (P4, RN-10). O motivo técnico **não** aparece na resposta.
4. **RF-04.4**: se a gravação falhar nos passos 4 a 6, nada fica gravado, nenhuma mensagem é publicada e a resposta é um erro sem detalhes técnicos.
5. **RF-04.5**: **não** chama o products-service (P3).
6. **RF-04.6**: depois de um checkout com sucesso, `GET /cart` do mesmo usuário responde o carrinho vazio, e um novo `POST /cart/items` cria um novo carrinho `active` (P10).

### RF-05: `GET /orders`

1. **RF-05.1**: rota **protegida**.
2. **RF-05.2**: responde **200** com a lista de **todos** os pedidos do usuário autenticado, cada um no formato da RF-03, com os itens.
3. **RF-05.3**: a lista é ordenada por `createdAt` **decrescente** (mais recente primeiro).
4. **RF-05.4**: pedidos de outros usuários **nunca** aparecem na lista.
5. **RF-05.5**: usuário sem pedidos recebe **200** com lista vazia (P7).

### RF-06: `GET /orders/:id`

1. **RF-06.1**: rota **protegida**.
2. **RF-06.2**: `id` que não é UUID → **400** `id deve ser um UUID válido`, sem consultar o banco.
3. **RF-06.3**: quando o pedido existe e pertence ao usuário autenticado, responde **200** com o pedido no formato da RF-03, com os itens.
4. **RF-06.4**: responde **404** `Pedido não encontrado` quando o pedido não existe **ou** pertence a outro usuário (P6). As duas situações têm exatamente a mesma resposta.

### RF-07: Respostas de erro

1. **RF-07.1**: todos os erros seguem o formato padrão do NestJS (`statusCode`, `message` e `error`), com mensagens em português.
2. **RF-07.2**: nenhuma resposta de erro expõe stack trace, SQL, detalhes do RabbitMQ ou dados de outro usuário.
3. **RF-07.3**: tabela resumo:

| Rota                  | 200 | 201 | 400                                              | 401       | 404                                   |
| --------------------- | --- | --- | ------------------------------------------------ | --------- | ------------------------------------- |
| `POST /cart/checkout` | —   | sim | corpo inválido; carrinho vazio ou inexistente    | sem token | —                                     |
| `GET /orders`         | sim | —   | —                                                | sem token | —                                     |
| `GET /orders/:id`     | sim | —   | `id` não é UUID                                  | sem token | pedido inexistente ou de outro usuário |

## 7. Requisitos funcionais: módulos

### RF-08: `OrdersModule` e `CartModule`

1. **RF-08.1**: o `OrdersModule` importa o `CartModule` e o `EventsModule`, mantém o registro de `Order` e `OrderItem` com `TypeOrmModule.forFeature`, e declara o `OrdersService` e o(s) controller(s) das três rotas.
2. **RF-08.2**: o `CartModule` passa a **exportar** o `CartService`. O `CartModule` **não** importa o `OrdersModule`, e não há `forwardRef` entre os dois.
3. **RF-08.3**: as regras do carrinho usadas no checkout (obter o carrinho ativo com bloqueio e marcá-lo como `completed`) ficam no `CartService`, que as oferece de forma que participem da **mesma transação** da criação do pedido. O `OrdersService` orquestra o checkout e não altera diretamente o status do carrinho.
4. **RF-08.4**: os controllers só recebem a requisição, extraem o `req.user.id` e repassam ao `OrdersService`. Regras de negócio, acesso ao banco e publicação ficam nos services.
5. **RF-08.5**: os controllers **não** declaram o `JwtAuthGuard`. A proteção vem do guard global.
6. **RF-08.6**: o `AppModule` não muda: `CartModule`, `OrdersModule` e `EventsModule` já estão registrados.
7. **RF-08.7**: as rotas existentes do carrinho (`GET /cart`, `POST /cart/items`, `DELETE /cart/items/:itemId`) continuam com o mesmo comportamento, e `POST /cart/checkout` não conflita com elas.

## 8. Requisitos funcionais: documentação

### RF-09: Swagger

1. **RF-09.1**: a tag `Orders` é adicionada à configuração do Swagger no `main.ts`, com uma descrição curta. O restante do bootstrap não muda.
2. **RF-09.2**: as três rotas aparecem na tag `Orders`, marcadas com autenticação Bearer, com um resumo da operação e as respostas da RF-07.3.
3. **RF-09.3**: o corpo do `POST /cart/checkout` aparece com `paymentMethod`, os quatro valores aceitos e um exemplo.
4. **RF-09.4**: o parâmetro `id` de `GET /orders/:id` aparece como UUID.
5. **RF-09.5**: as respostas de sucesso mostram o formato da RF-03 (pedido único ou lista).

## 9. Requisitos não funcionais

### RNF-01: Tipagem explícita

**Todas as funções, variáveis e parâmetros precisam ser tipados.**

A regra vale para todo código escrito nesta spec: arquivos novos são tipados por inteiro e, em arquivos existentes, todo trecho adicionado ou modificado. Os itens abaixo detalham o que isso significa.

1. **RNF-01.1: Funções.** Toda função e todo método (públicos, privados, arrow functions, callbacks, mappers, helpers e funções de teste auxiliares) declara o **tipo de retorno** explicitamente. Funções assíncronas declaram `Promise` com o tipo resolvido.
2. **RNF-01.2: Parâmetros.** Todo parâmetro declara o tipo explicitamente, inclusive parâmetros de callbacks (ex.: funções passadas para iteração de listas, ordenação, redução e para a transação do banco) e parâmetros desestruturados.
3. **RNF-01.3: Variáveis.** Toda variável e constante declara o tipo explicitamente, mesmo quando o TypeScript conseguiria inferir, inclusive em desestruturação.
4. **RNF-01.4: Propriedades.** Toda propriedade de classe (DTOs, entidades, services, controllers) e todo campo de interface ou tipo declara o tipo.
5. **RNF-01.5: Sem `any`.** É proibido usar `any`, explícito ou implícito, inclusive em conversões. Quando o tipo for realmente desconhecido, usar `unknown` e estreitar o tipo antes do uso. É proibido silenciar o compilador com comentários de supressão de erro de tipo.
6. **RNF-01.6: Tipos de domínio.** Valores com conjunto fechado usam os enums do domínio (`PaymentMethod`, `OrderStatus`, `CartStatus`), não texto solto.
7. **RNF-01.7: Configuração.** O `tsconfig.json` e o `eslint.config.mjs` **não** são alterados nesta spec, porque regras globais mais rígidas quebrariam código existente fora do escopo. A conformidade é verificada nos critérios CA-38 e CA-39.

### RNF-02: Observabilidade

1. **RNF-02.1**: o checkout registra no log (Logger do NestJS) a criação de cada pedido com `orderId`, `userId` e `total`.
2. **RNF-02.2**: toda falha de publicação é registrada como erro com o `orderId` (RF-04.3).

## 10. Fluxo esperado do `POST /cart/checkout`

1. A requisição chega com `paymentMethod` no corpo e o token Bearer no header.
2. O `JwtAuthGuard` global valida o token. Token ausente ou inválido → **401**.
3. O `ValidationPipe` valida o corpo. `paymentMethod` inválido, ausente ou campo extra → **400**.
4. O `OrdersService` abre uma transação:
   - obtém o carrinho ativo do usuário, bloqueado, por meio do `CartService`;
   - carrinho inexistente ou sem itens → **400** `Carrinho vazio`, e a transação é desfeita;
   - cria o pedido `pending` com os itens copiados do carrinho;
   - marca o carrinho como `completed`, por meio do `CartService`;
   - confirma a transação.
5. Com o pedido gravado, monta a `PaymentOrderMessage` e publica no exchange `payments` com a routing key `payment.order`. Falha aqui só gera log.
6. Responde **201** com o pedido.
7. Depois, de forma independente, o payments-service consome a mensagem da `payment_queue`.

## 11. Estrutura de pastas esperada (alto nível)

| Caminho                                    | Conteúdo                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `docs/specs/04-finalizacao-do-pedido.md`   | Esta spec.                                                                                   |
| `src/orders/orders.module`                 | Importa `CartModule` e `EventsModule`; declara service e controller(s).                      |
| `src/orders/` (controller ou controllers)  | `POST /cart/checkout`, `GET /orders`, `GET /orders/:id`.                                      |
| `src/orders/orders.service`                | Checkout, listagem e detalhe.                                                                |
| `src/orders/enums/`                        | `PaymentMethod` (novo) e `OrderStatus` (existente).                                          |
| `src/orders/dto/`                          | Corpo do checkout e resposta do pedido.                                                      |
| `src/orders/mappers/`                      | Conversão de `Order` para a resposta da RF-03; `toPaymentOrderMessage` existente, sem mudança. |
| `src/orders/entities/order.entity`         | `paymentMethod` tipado com `PaymentMethod` (RF-01.2).                                        |
| `src/cart/cart.module`                     | Exporta `CartService`.                                                                       |
| `src/cart/cart.service`                    | Obter carrinho ativo bloqueado e marcá-lo como `completed` dentro de uma transação.          |
| `src/main`                                 | Tag `Orders` no Swagger.                                                                     |
| `test/orders.e2e-spec`                     | Rotas desta spec com o `PaymentQueueService` simulado.                                       |

## 12. Variáveis de ambiente

Nenhuma variável nova. A conexão com o RabbitMQ continua usando a `RABBITMQ_URL` já existente.

## 13. Critérios de aceite

Nos testes automatizados e2e, o `PaymentQueueService` é **simulado**, para verificar a mensagem enviada sem depender do RabbitMQ. Nos testes manuais, são usados o RabbitMQ e o payments-service reais.

### `POST /cart/checkout`

| #     | Critério                                                                                                                                                  | Como verificar                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CA-01 | Sem token → 401.                                                                                                                                          | Teste e2e.                                                                      |
| CA-02 | Com carrinho de 2 itens (subtotais 59.97 e 25.00) e `paymentMethod` `pix` → 201 com pedido `pending`, `paymentMethod` `pix`, `userId` do token, `cartId` do carrinho, `total` 84.97 e 2 itens. | Teste e2e.                                                    |
| CA-03 | Os itens do pedido têm os mesmos `productId`, `productName`, `price`, `quantity` e `subtotal` dos itens do carrinho, e não trazem `order` nem `orderId`. | Teste e2e comparando com o carrinho antes do checkout.                          |
| CA-04 | Depois do checkout existem 1 registro em `orders` e 2 em `order_items` para o pedido, e `orders.total` é igual ao `total` da resposta.                    | Teste e2e consultando as tabelas.                                               |
| CA-05 | Depois do checkout, o carrinho tem status `completed` no banco e mantém os itens e o `total`.                                                             | Teste e2e consultando `carts` e `cart_items`.                                   |
| CA-06 | Depois do checkout, `GET /cart` responde o carrinho vazio (`id` `null`), e um novo `POST /cart/items` cria um carrinho `active` com outro `id`.            | Teste e2e.                                                                      |
| CA-07 | Cada um dos valores `credit_card`, `debit_card`, `pix` e `boleto` é aceito e gravado no pedido.                                                           | Teste e2e, um por valor.                                                        |
| CA-08 | `paymentMethod` ausente, `paypal`, `PIX` (maiúsculo), número ou vazio → 400 com a mensagem da RF-02, sem criar pedido e sem mudar o carrinho.              | Teste e2e, um por valor.                                                        |
| CA-09 | Corpo com `userId`, `cartId`, `total`, `status` ou `items` → 400, sem criar pedido.                                                                       | Teste e2e.                                                                      |
| CA-10 | Usuário sem carrinho ativo → 400 `Carrinho vazio`, sem criar pedido e sem publicar mensagem.                                                              | Teste e2e.                                                                      |
| CA-11 | Usuário com carrinho ativo sem itens (último item removido) → 400 `Carrinho vazio`; o carrinho continua `active` e nenhum pedido é criado.                 | Teste e2e.                                                                      |
| CA-12 | Usuário com apenas carrinho `completed` → 400 `Carrinho vazio`.                                                                                           | Teste e2e.                                                                      |
| CA-13 | O checkout publica **uma** mensagem com `orderId` = `id` do pedido, `userId`, `amount` = `total`, `paymentMethod`, `createdAt` do pedido e um item (`productId`, `quantity`, `price`) para cada item do pedido. | Teste e2e verificando a chamada ao `PaymentQueueService` simulado. |
| CA-14 | A mensagem é publicada **depois** de o pedido estar gravado: no momento da publicação, o pedido já existe no banco com status `pending`.                   | Teste e2e ou unitário consultando o pedido dentro da simulação da publicação.   |
| CA-15 | Com a publicação falhando, a resposta é 201 com o pedido, o pedido continua `pending` no banco, o carrinho continua `completed` e o erro aparece no log com o `orderId`. | Teste e2e com o `PaymentQueueService` simulado lançando erro; teste unitário verificando o log. |
| CA-16 | Se a gravação falhar no meio do checkout, nenhum pedido ou item de pedido fica gravado, o carrinho continua `active` e nenhuma mensagem é publicada.        | Teste unitário do `OrdersService` simulando falha na gravação.                  |
| CA-17 | Dois checkouts simultâneos do mesmo usuário → um 201 e um 400 `Carrinho vazio`, **um** único pedido no banco e **uma** única mensagem publicada.           | Teste e2e disparando as duas requisições em paralelo.                           |
| CA-18 | Um carrinho com subtotais 0.10 e 0.20 gera pedido com `total` exatamente 0.3 e mensagem com `amount` 0.3.                                                  | Teste unitário do `OrdersService`.                                              |
| CA-19 | O checkout do usuário A não altera nem usa o carrinho do usuário B.                                                                                       | Teste e2e com dois tokens.                                                      |
| CA-20 | O checkout não chama o products-service.                                                                                                                  | Teste e2e verificando zero chamadas ao client simulado.                         |
| CA-21 | Seller e buyer conseguem finalizar o próprio carrinho.                                                                                                    | Teste e2e com tokens dos dois roles.                                            |

### `GET /orders`

| #     | Critério                                                                                                                                                  | Como verificar                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CA-22 | Sem token → 401.                                                                                                                                          | Teste e2e.                                                                      |
| CA-23 | Usuário sem pedidos → 200 com lista vazia.                                                                                                                | Teste e2e.                                                                      |
| CA-24 | Usuário com 3 pedidos → 200 com os 3, do mais recente para o mais antigo, cada um com os itens e no formato da RF-03.                                      | Teste e2e com pedidos criados em momentos diferentes.                           |
| CA-25 | Pedidos do usuário B não aparecem na lista do usuário A.                                                                                                  | Teste e2e com dois tokens.                                                      |
| CA-26 | `total`, `price` e `subtotal` vêm como número.                                                                                                            | Teste e2e.                                                                      |

### `GET /orders/:id`

| #     | Critério                                                                                                                                                  | Como verificar                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CA-27 | Sem token → 401.                                                                                                                                          | Teste e2e.                                                                      |
| CA-28 | Pedido do próprio usuário → 200 com o pedido e os itens, igual ao devolvido pelo checkout.                                                                | Teste e2e.                                                                      |
| CA-29 | `id` não UUID → 400 `id deve ser um UUID válido`.                                                                                                         | Teste e2e.                                                                      |
| CA-30 | UUID sem pedido → 404 `Pedido não encontrado`.                                                                                                            | Teste e2e.                                                                      |
| CA-31 | Usuário A consultando o pedido do usuário B → 404 com o mesmo corpo do CA-30.                                                                             | Teste e2e com dois tokens.                                                      |

### Módulos, Swagger, não regressão e qualidade

| #     | Critério                                                                                                                                                  | Como verificar                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CA-32 | O `OrdersModule` importa `CartModule` e `EventsModule`; o `CartModule` exporta o `CartService` e não importa o `OrdersModule`; não existe `forwardRef`.    | Revisão de código; aplicação sobe sem erro de dependência.                      |
| CA-33 | `http://localhost:3003/api` mostra a tag `Orders` com as três rotas, cadeado Bearer, corpo do checkout com os quatro valores e as respostas da RF-07.3.    | Abrir no navegador.                                                             |
| CA-34 | Fluxo manual completo: login no users-service, criação de produto no products-service, adição ao carrinho, checkout, listagem e detalhe no checkout; a mensagem aparece na `payment_queue` e o payments-service registra no log que recebeu e validou o pedido. | Teste manual com users (3000), products (3001), checkout (3003), payments-service e RabbitMQ no ar. |
| CA-35 | Com o RabbitMQ fora do ar, o checkout continua respondendo 201 e grava o pedido `pending`.                                                                | Teste manual parando o RabbitMQ.                                                |
| CA-36 | As rotas do carrinho e o `GET /health` continuam com o mesmo comportamento.                                                                               | Testes e2e existentes passando.                                                 |
| CA-37 | Nenhum arquivo em `src/events/`, `src/auth/`, `src/health/`, `src/products-client/` e o mapper `toPaymentOrderMessage` foi alterado; o schema do banco não mudou. | `git diff --stat` nesses caminhos vazio; comparar colunas das tabelas antes e depois. |
| CA-38 | Todo código criado ou alterado nesta spec declara tipo de retorno em todas as funções e métodos, tipo em todos os parâmetros (inclusive callbacks), em todas as variáveis e constantes e em todas as propriedades (RNF-01.1 a RNF-01.4). | Revisão de código dos arquivos do `git diff`.                     |
| CA-39 | Não existe `any` nem comentário de supressão de erro de tipo no código criado ou alterado nesta spec (RNF-01.5).                                           | Buscar `any`, `@ts-ignore` e `@ts-expect-error` nas linhas do `git diff`.        |
| CA-40 | Existem testes unitários do `OrdersService` (todas as RN e os erros), dos controllers do `OrdersModule` e da nova operação do `CartService`.               | `pnpm run test`.                                                                |
| CA-41 | `pnpm run build`, `pnpm run lint` e `pnpm run test` terminam sem erros. `pnpm run test:e2e` passa com o `checkout-db` no ar.                               | Rodar os comandos.                                                              |
| CA-42 | Nenhum arquivo de outro serviço (users, products, payments, api-gateway) foi alterado.                                                                    | `git status` nos outros repositórios.                                           |

## 14. Pontos de atenção

- **Publicação silenciosa:** o `RabbitmqService` não lança erro quando não há canal ou quando a publicação falha; ele só registra no log. Na prática, o checkout pode responder 201 sem que a mensagem tenha chegado ao RabbitMQ. Isso é aceito nesta spec (P4), mas o pedido pode ficar `pending` para sempre. Uma solução de reenvio (outbox ou job de reprocessamento) deve ser tratada em spec futura.
- **Fila sem consumidor declarado:** a `payment_queue` é declarada e ligada ao exchange pelo payments-service quando ele sobe. Se o checkout publicar antes de o payments-service ter subido pelo menos uma vez, o exchange não tem fila ligada e a mensagem é descartada pelo RabbitMQ. No teste manual, subir o payments-service antes.
- **Bloqueio e itens eager:** o bloqueio do carrinho no PostgreSQL não funciona junto com o carregamento automático dos itens (já tratado na spec 03). Os itens do carrinho precisam ser lidos separadamente, depois do bloqueio, dentro da mesma transação.
- **Pedido com itens para a mensagem:** o mapper `toPaymentOrderMessage` depende de `order.items` e `order.createdAt`. A mensagem deve ser montada a partir do pedido **gravado**, com os itens carregados, e não a partir do carrinho.
- **Validação da mensagem:** `publishPaymentOrderSafe` exige `amount` igual à soma de `price × quantity` dos itens e `price` > 0. Isso é garantido pelo cálculo em centavos (RN-05) e pela validação de preço do products-service. Se a validação falhar, é sinal de bug e fica no log (P4).
- **Snapshot desatualizado:** o pedido usa o preço gravado no carrinho. Se o seller mudou o preço ou desativou o produto depois da adição, o pedido sai com o valor antigo (P3). Se o marketplace exigir revalidação, ela entra em spec futura.
- **Estoque não validado:** é possível criar pedido com quantidade maior que o estoque. A validação e a baixa de estoque estão fora do escopo.
- **Prefixo `/cart` em dois módulos:** `POST /cart/checkout` fica no `OrdersModule`, enquanto as demais rotas `/cart` ficam no `CartController`. As rotas não conflitam, mas o Swagger mostra o checkout na tag `Orders` (P12).
- **Ordenação por data:** pedidos criados no mesmo instante têm `createdAt` igual, e a ordem entre eles não é garantida. Os testes de ordenação devem criar pedidos em momentos diferentes.
- **Tipagem sem regra de lint:** o projeto desliga `no-explicit-any` e `noImplicitAny`. A RNF-01 vale para o código desta spec, mas não é imposta automaticamente pelo build; a verificação é feita na revisão (CA-38 e CA-39).
- **Adição concorrente com o checkout:** um `POST /cart/items` disparado ao mesmo tempo que o checkout do mesmo usuário pode encontrar o carrinho já `completed` depois de esperar o bloqueio e responder 500. Não há critério de aceite para esse caso nesta spec, e o `POST /cart/items` não é alterado; tratar em spec futura do carrinho.
- **Status do pedido:** o pedido fica `pending` até que uma spec futura consuma o resultado do pagamento. Nenhuma rota desta spec muda o status.
- **E2e e infraestrutura:** os e2e precisam do `checkout-db`, porque testam transação, bloqueio e gravação. O `PaymentQueueService` é simulado, e cada teste deve limpar `orders`, `order_items`, `carts` e `cart_items` para não depender da ordem de execução.

## 15. Commits

Esta aula termina com **um único commit** no repositório do checkout-service.

- O commit inclui esta spec e toda a implementação: `PaymentMethod`, DTOs, `OrdersService`, controller(s), mapper de resposta, alterações no `CartService` e no `CartModule`, tag do Swagger e testes.
- O `.env` é ignorado pelo git e não entra no commit.
- Antes do commit, rodar `pnpm run lint`, `pnpm run build` e `pnpm run test` e garantir que tudo passa.
- A mensagem segue o padrão do histórico, em português. Sugestão: `feat(orders): finaliza o carrinho, cria o pedido e publica o pagamento`.
