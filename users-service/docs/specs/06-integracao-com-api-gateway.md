# SPEC — Integração do users-service com o api-gateway

**Serviços:** users-service e api-gateway
**Projeto:** marketplace-ms
**Status:** Proposta
**Data:** 2026-10-11
**Revisão:** 2026-10-13 — as rotas `/auth/*` do gateway passam a ser encaminhadas pelo `ProxyService`, no mesmo padrão do `ProductsController` (spec 05 do products-service)

---

## 1. Contexto

O **users-service** (porta 3000) já possui:

- `POST /auth/register` e `POST /auth/login` (públicos), com emissão de JWT cujo payload contém `sub`, `email` e `role` (spec 03)
- `JwtAuthGuard` global e decorator `@Public()`; usuário autenticado disponível em `req.user` com `id`, `email` e `role` (spec 04)
- `GET /users/profile`, `GET /users/sellers` e `GET /users/:id`, todos protegidos (spec 05)
- Não possui endpoint de health, endpoint de validação de token nem documentação Swagger

O **api-gateway** (porta 3005) já possui:

- `ProxyService` com circuit breaker, retry, timeout e fallback, capaz de encaminhar requisições ao serviço `users` repassando headers e informações do usuário (`x-user-id`, `x-user-email`, `x-user-role`)
- Tratamento de erros 4xx no `ProxyService`: o status e o corpo do erro do serviço chegam ao cliente, **sem** retry e **sem** contar falha no circuit breaker (correção feita junto da spec 05 do products-service)
- `ProductsController` e `ProductsModule` em `src/products/`, que encaminham todas as rotas de produtos por `ProxyService.proxyRequest()` e servem de **modelo** para esta spec
- `JwtStrategy` e `JwtAuthGuard` (Passport), `SessionGuard` e `RoleGuard`
- `AuthController` com `POST /auth/login` e `POST /auth/register`, que delega para um `AuthService` que chama o users-service **diretamente** via `HttpService`, fora do `ProxyService`
- Health check que consulta `GET {url}/health` de cada serviço configurado
- Swagger em `/api`
- `serviceConfig.users.url` lido de `USERS_SERVICE_URL`

### Lacunas identificadas no estado atual

Uma análise do código mostrou que, hoje, o fluxo ponta a ponta **não funciona** ou funciona de forma inconsistente, pelos motivos abaixo. Cada lacuna é tratada por um requisito desta spec:

| # | Lacuna | Tratada em |
|---|--------|------------|
| L1 | O users-service não expõe `GET /health`; o gateway sempre o considera indisponível | RF-02 |
| L2 | O `AuthService` do gateway chama `{USERS_SERVICE_URL}/login` em vez de `/auth/login` | RF-05, RF-06 |
| L3 | O gateway converte qualquer erro do users-service em 401 (ex.: e-mail duplicado no registro vira 401 genérico "Registration failed" em vez de 409) | RF-05, RF-06 |
| L4 | Não existe nenhuma rota no gateway para `/users/*`; o `ProxyService` existe, mas nenhum controller o utiliza | RF-05 |
| L5 | A `JwtStrategy` do gateway não está registrada como provider, e o `JwtAuthGuard` não é aplicado a nenhuma rota | RF-07 |
| L6 | O `JWT_SECRET` do gateway é um valor de exemplo, diferente do usado pelo users-service; nenhum token emitido pelo users-service seria aceito | RF-04 |
| L7 | A `JwtStrategy` do gateway tenta revalidar um campo `token` que não existe no payload emitido pelo users-service, o que faz toda validação falhar | RF-07 |
| L8 | As rotas `/auth/*` **não passam pelo `ProxyService`**: o `AuthController` delega a um `AuthService` que faz HTTP direto via `HttpService`. Com isso, essas rotas ficam sem circuit breaker, retry, timeout e fallback, e o tratamento de erro é próprio e diverge do restante do gateway | RF-05, RF-06 |
| L9 | O `RegisterDto` do gateway valida e transforma o corpo antes de encaminhar (ex.: preenche `role = 'user'`, valor que o users-service rejeita, pois só aceita `seller` ou `buyer`) | RF-05 |

## 2. Objetivo

Permitir que um cliente use **apenas o api-gateway (porta 3005)** para se registrar, fazer login, validar o token e consultar perfil e vendedores. O gateway valida o JWT quando a rota exige e encaminha **todas** as requisições ao users-service pelo `ProxyService`, com a mesma resiliência e o mesmo tratamento de erro das demais rotas. O users-service passa a ser observável (health) e documentado (Swagger).

## 3. Escopo

### Dentro do escopo

**users-service**
- `GET /auth/validate-token`
- `GET /health`
- Documentação Swagger/OpenAPI em `/api`

**api-gateway**
- Configuração de `USERS_SERVICE_URL` e `JWT_SECRET`
- `UsersController` único em `src/users/`, que expõe `/auth/*` e `/users/*` e encaminha tudo por `ProxyService.proxyRequest('users', ...)`
- Remoção do `AuthController` e das chamadas HTTP diretas do `AuthService`
- Ativação da validação JWT nas rotas protegidas, usando a `JwtStrategy` e o `JwtAuthGuard` existentes
- Compatibilidade das rotas já expostas pelo gateway (mesmos paths, métodos e comportamento para o consumidor)

### Fora do escopo

- Alteração da lógica do `JwtAuthGuard`, do `SessionGuard` ou do `RoleGuard` do gateway
- Session management (session token, `x-session-token`, `/session/validate`)
- Autorização por role nas rotas de usuários
- Refresh token, revogação ou blacklist de tokens
- Novos endpoints de negócio no users-service além dos listados
- Integração dos demais serviços (products, checkout, payments)

---

## 4. Requisitos Funcionais — users-service

### RF-01 — GET /auth/validate-token

1. **RF-01.1** — Rota **protegida**: exige JWT válido no header `Authorization: Bearer <token>`. Não deve ser marcada com `@Public()`.
2. **RF-01.2** — A validação do token é feita pelo `JwtAuthGuard` global já existente; o endpoint não deve reimplementar a verificação.
3. **RF-01.3** — Em caso de sucesso, responde **200 OK** com um objeto contendo exatamente:
   - `userId` — identificador do usuário (corresponde ao `id` de `req.user`)
   - `email`
   - `role`
4. **RF-01.4** — Os dados vêm do usuário autenticado (`req.user`), sem consulta ao banco de dados.
5. **RF-01.5** — A resposta nunca contém senha, hash, nem campos técnicos do token (`iat`, `exp`, `sub`).
6. **RF-01.6** — Token ausente, malformado, com assinatura inválida ou expirado → **401 Unauthorized** (comportamento do guard global).
7. **RF-01.7** — Pertence ao controller de autenticação já existente (prefixo `/auth`).
8. **RF-01.8** — Finalidade: permitir que o api-gateway (ou outro serviço interno) confirme a validade de um token e obtenha a identidade do usuário. Esta spec **não** obriga o gateway a chamar este endpoint em cada requisição (ver RF-07).

### RF-02 — GET /health

1. **RF-02.1** — Rota **pública**: marcada com `@Public()`, não exige token e funciona mesmo quando um token inválido é enviado.
2. **RF-02.2** — Responde **200 OK** com exatamente `{ "status": "ok", "service": "users-service" }`.
3. **RF-02.3** — Não depende de banco de dados nem de serviços externos para responder (verificação de liveness).
4. **RF-02.4** — Deve estar na raiz do serviço (`/health`), sem prefixo, pois é o caminho consultado pelo health check do gateway.
5. **RF-02.5** — A rota `GET /` existente não deve ter o comportamento alterado.

### RF-03 — Swagger / OpenAPI

1. **RF-03.1** — A documentação deve ser gerada automaticamente e ficar acessível em `GET /api` (interface) quando o serviço estiver em execução.
2. **RF-03.2** — Metadados do documento: título **"Users Service"**, versão **"1.0"** e uma descrição curta do serviço.
3. **RF-03.3** — Deve declarar o esquema de segurança **Bearer (JWT)**, permitindo informar o token pelo botão "Authorize" e enviá-lo nas rotas protegidas.
4. **RF-03.4** — Todas as rotas do serviço devem aparecer documentadas, agrupadas por tags (ex.: `Auth`, `Users`, `Health`):
   - `POST /auth/register`, `POST /auth/login`, `GET /auth/validate-token`
   - `GET /users/profile`, `GET /users/sellers`, `GET /users/:id`
   - `GET /health`
5. **RF-03.5** — As rotas protegidas devem ser marcadas como exigindo Bearer Auth; as rotas públicas (`register`, `login`, `health`) não.
6. **RF-03.6** — Os corpos de `POST /auth/register` e `POST /auth/login` devem aparecer documentados com seus campos e regras de validação, a partir dos DTOs existentes.
7. **RF-03.7** — Cada rota deve documentar seus principais códigos de resposta (sucesso, 400, 401, 404, 409, conforme aplicável).
8. **RF-03.8** — A rota `/api` é pública (não exige token) e não deve ser bloqueada pelo `JwtAuthGuard` global.
9. **RF-03.9** — Nenhum contrato de request/response existente pode mudar por causa da documentação.

---

## 5. Requisitos Funcionais — api-gateway

### RF-04 — Configuração de ambiente

1. **RF-04.1** — O `.env` do gateway deve conter `USERS_SERVICE_URL=http://localhost:3000`.
2. **RF-04.2** — O `JWT_SECRET` do gateway deve ser **o mesmo** valor usado pelo users-service, já que o gateway valida localmente tokens emitidos pelo users-service.
3. **RF-04.3** — O `.env.example` do gateway deve listar todas as variáveis necessárias (sem valores secretos) e indicar que `JWT_SECRET` precisa ser igual ao do users-service.
4. **RF-04.4** — Nenhum secret pode ser versionado; os arquivos `.env` continuam ignorados pelo git.

### RF-05 — `UsersController`: rotas `/auth/*` e `/users/*` via `ProxyService`

1. **RF-05.1** — O gateway deve ter um **único `UsersController`** em `src/users/`, registrado no `UsersModule`, que expõe as rotas abaixo e encaminha **cada uma** ao users-service por `ProxyService.proxyRequest('users', ...)`, mantendo método e caminho. O controller existente (hoje só com `/users/*`) é estendido para isso, seguindo o padrão do `ProductsController` e do `ProductsModule` em `src/products/`.

   | Rota no gateway (3005)       | Destino no users-service (3000) | Token no gateway | Tag Swagger      |
   |------------------------------|---------------------------------|------------------|------------------|
   | `POST /auth/register`        | `POST /auth/register`           | não exige        | `Authentication` |
   | `POST /auth/login`           | `POST /auth/login`              | não exige        | `Authentication` |
   | `GET /auth/validate-token`   | `GET /auth/validate-token`      | obrigatório      | `Authentication` |
   | `GET /users/profile`         | `GET /users/profile`            | obrigatório      | `Users`          |
   | `GET /users/sellers`         | `GET /users/sellers`            | obrigatório      | `Users`          |
   | `GET /users/:id`             | `GET /users/:id`                | obrigatório      | `Users`          |

2. **RF-05.2** — Como o controller atende dois prefixos (`/auth` e `/users`), o `JwtAuthGuard` deve ser aplicado **por rota** (`@UseGuards(JwtAuthGuard)` em cada rota protegida), e não na classe, para que `register` e `login` continuem públicos. A forma de declarar os prefixos (controller sem prefixo com caminhos completos, por exemplo) fica para o plano, desde que os paths finais sejam exatamente os da tabela.
3. **RF-05.3 — Rotas públicas** (`POST /auth/register`, `POST /auth/login`):
   - encaminhadas **sem** autenticação no gateway;
   - o corpo é encaminhado **sem alterações**: o gateway não valida, não remove, não acrescenta campos e não aplica valores padrão (corrige L9). Para isso, o corpo deve ser recebido como objeto genérico (ex.: `Record<string, unknown>`, como em `ProductsController.create`), de modo que o `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`) não atue sobre ele. A validação é do users-service, e o 400 dele (com a lista de mensagens) é repassado ao cliente;
   - nenhum `userInfo` é enviado ao `ProxyService`.
4. **RF-05.4 — Rotas protegidas** (`GET /auth/validate-token`, `GET /users/profile`, `GET /users/sellers`, `GET /users/:id`):
   - protegidas por `@UseGuards(JwtAuthGuard)`; sem token, ou com token malformado, adulterado ou expirado, o gateway responde **401** **sem** chamar o users-service;
   - o header `Authorization` recebido é **repassado intacto** ao `ProxyService` (o users-service também valida o token);
   - o usuário autenticado no gateway (`userId`, `email`, `role`, obtido com `@CurrentUser()`) é passado como `userInfo` ao `ProxyService`, que já o envia como headers `x-user-*`.
5. **RF-05.5** — Ordem de declaração: `GET /users/profile` e `GET /users/sellers` vêm **antes** de `GET /users/:id`, para que `profile` e `sellers` nunca sejam tratados como ID.
6. **RF-05.6** — O parâmetro `:id` é encaminhado de forma que um valor recebido do cliente **nunca** consiga alterar o caminho de destino (ex.: `..`, `/` ou `?` dentro do parâmetro), com a mesma proteção usada no `ProductsController` (função `segment`). Se a função for compartilhada entre os dois controllers, ela deve ir para um utilitário comum, sem mudar o comportamento de produtos.
7. **RF-05.7** — Em caso de sucesso, o gateway devolve ao cliente o **mesmo status** e o **mesmo corpo** retornados pelo users-service, sem transformação:
   - `POST /auth/register` → **201** com o usuário público;
   - `POST /auth/login` → **200** com `user` e `token` (a rota deve declarar `@HttpCode(200)`, já que o padrão do Nest para `POST` é 201);
   - `GET` → **200** com o objeto ou array retornado.
8. **RF-05.8** — Erros 4xx do users-service (`400`, `401`, `404`, `409`) chegam ao cliente com o **mesmo status e o mesmo corpo**, incluindo a mensagem real (ex.: `409` de e-mail já cadastrado, `401` de credenciais inválidas). Isso já é feito pelo `ProxyService` e **não** deve ser reimplementado no controller (nenhum `try/catch` que converta erros).
9. **RF-05.9** — Erros 4xx do users-service **não** disparam retry e **não** contam como falha no circuit breaker (comportamento atual do `ProxyService`). Assim, uma sequência de logins com senha errada não abre o circuito do serviço `users`.
10. **RF-05.10** — Se o users-service estiver indisponível, responder 5xx ou não responder no tempo limite, a resposta ao cliente vem do fallback do `ProxyService` (`503 Service Unavailable`), nunca `401`.
11. **RF-05.11** — Mensagens de erro devolvidas ao cliente não expõem detalhes internos (URL do serviço, stack trace, objeto de erro do cliente HTTP).
12. **RF-05.12** — Os limites de requisição (`@Throttle`) hoje configurados no `AuthController` são mantidos nas mesmas rotas: `POST /auth/login` com `short` (5 por minuto) e `POST /auth/register` com `medium` (3 por minuto).
13. **RF-05.13** — Swagger do gateway:
    - as rotas `/auth/*` ficam na tag `Authentication` e as `/users/*` na tag `Users`;
    - as rotas protegidas são marcadas com Bearer Auth (`JWT-auth`); `register` e `login` não;
    - os corpos de `register` e `login` são documentados com `@ApiBody` refletindo o contrato **do users-service** (em `register`, `role` aceita apenas `seller` ou `buyer`). A documentação não pode fazer o `ValidationPipe` do gateway validar ou remover campos (ver RF-05.3);
    - cada rota documenta os status que o cliente pode receber pelo gateway, incluindo `503`; a resposta de `login` documenta o corpo real (`user` e `token`).
14. **RF-05.14** — O `UsersModule` continua importando o `ProxyModule` e o `AuthModule` (que registra a `JwtStrategy` usada pelo guard), como o `ProductsModule`.

### RF-06 — Remoção do `AuthController` e enxugamento do `AuthService`

1. **RF-06.1** — O `AuthController` do gateway (`src/auth/controllers/auth.controller.ts`) deve ser **removido**, junto do seu teste e do registro em `AuthModule.controllers`. As rotas `POST /auth/login` e `POST /auth/register` passam a existir **apenas** no `UsersController` (RF-05), sem rotas duplicadas.
2. **RF-06.2** — O `AuthService` do gateway deixa de fazer encaminhamento de rotas: os métodos `login`, `register` e o tratamento de erro do users-service (`handleUsersServiceError`) são **removidos**, assim como os tipos usados só por eles.
3. **RF-06.3** — O que ainda é usado fora do fluxo de proxy é **mantido** sem mudança de comportamento, em especial `validateSessionToken`, do qual o `SessionGuard` depende (session management está fora do escopo). Se, após a remoção, o `AuthService` ou o `HttpModule` do `AuthModule` ficarem sem uso, podem ser removidos; a decisão fica para o plano, desde que o `SessionGuard` continue compilando e funcionando como hoje.
4. **RF-06.4** — Os DTOs `LoginDto` e `RegisterDto` do gateway **não** podem ser usados como tipo de `@Body()` nas rotas de RF-05. Podem ser removidos ou mantidos apenas como documentação, desde que reflitam o contrato do users-service (sem o valor padrão `role = 'user'`).
5. **RF-06.5** — Nenhuma rota do gateway pode chamar o users-service por `HttpService` diretamente; todo tráfego de requisições de clientes para o users-service passa pelo `ProxyService`. (O health check do gateway não é afetado por esta regra.)

### RF-07 — Validação do JWT no gateway

1. **RF-07.1** — As rotas protegidas de RF-05.4 devem usar o **`JwtAuthGuard` existente** do gateway. Requisições sem token ou com token inválido/expirado são rejeitadas com **401** pelo próprio gateway, **sem** chamar o users-service.
2. **RF-07.2** — A `JwtStrategy` existente deve estar registrada como provider no módulo de autenticação do gateway, para que o guard funcione (corrige L5).
3. **RF-07.3** — A `JwtStrategy` deve aceitar tokens emitidos pelo users-service, cujo payload contém `sub`, `email` e `role`, e produzir o usuário autenticado `{ userId, email, role }` (corrige L7). A verificação de assinatura e expiração continua sendo feita pelo Passport com o `JWT_SECRET` compartilhado; nenhum campo inexistente no payload pode ser exigido.
4. **RF-07.4** — A lógica do `JwtAuthGuard` (verificação de `isPublic` e tratamento de erro) **não** deve ser alterada.
5. **RF-07.5** — As rotas `POST /auth/register`, `POST /auth/login`, os health checks e o Swagger do gateway continuam acessíveis sem token.
6. **RF-07.6** — O `SessionGuard` não deve ser aplicado a nenhuma rota desta spec.

### RF-08 — Health check do users-service no gateway

1. **RF-08.1** — Com o users-service no ar, o health do gateway deve reportar o serviço `users` como **healthy**, consultando o `GET /health` criado em RF-02.
2. **RF-08.2** — Com o users-service fora do ar, o health do gateway deve reportar `users` como **unhealthy** e o status geral como **degraded**, sem derrubar o gateway.
3. **RF-08.3** — O mecanismo de health check do gateway não deve ser alterado.

### RF-09 — Compatibilidade com o consumidor

1. **RF-09.1** — As rotas já expostas pelo gateway (`POST /auth/register`, `POST /auth/login`, `GET /users/profile`, `GET /users/sellers`, `GET /users/:id`) mantêm **os mesmos paths e métodos**. A única rota nova no gateway é `GET /auth/validate-token`.
2. **RF-09.2** — Para o consumidor, os status de sucesso e os corpos de resposta não mudam (`201` no registro, `200` com `user` e `token` no login, `200` nas consultas).
3. **RF-09.3** — As mudanças visíveis ao consumidor são apenas as correções desta spec: erros 4xx passam a trazer o status e a mensagem reais do users-service (em vez de 401 genérico), mensagens de validação (400) passam a vir do users-service, e o corpo do registro deixa de receber `role = 'user'` injetado pelo gateway.
4. **RF-09.4** — Os limites de requisição por rota (RF-05.12) e o throttle global do gateway permanecem iguais.

---

## 6. Fluxo Esperado (via gateway, porta 3005)

```
Cliente ──► api-gateway :3005 ──► users-service :3000

Todas as rotas: UsersController ──► ProxyService.proxyRequest('users', ...)
                (circuit breaker ► retry ► timeout ► HTTP; fallback 503)

1) POST /auth/register   (público)
   gateway ──► ProxyService (corpo intacto) ──► POST /auth/register
        ──► 201 + usuário público
        ──► 409 e-mail já cadastrado / 400 dados inválidos (status e corpo repassados)

2) POST /auth/login      (público)
   gateway ──► ProxyService (corpo intacto) ──► POST /auth/login
        ──► 200 + { user, token }
        ──► 401 credenciais inválidas (mensagem do users-service repassada)

3) GET /auth/validate-token  (Authorization: Bearer <token>)
   gateway: JwtAuthGuard valida token ── inválido ──► 401 (não chama o users-service)
        │ válido
        ▼
   ProxyService (repasse do Authorization + x-user-*) ──► GET /auth/validate-token
        ──► 200 + { userId, email, role }

4) GET /users/profile    (Authorization: Bearer <token>)
   mesmo fluxo do item 3 ──► GET /users/profile ──► 200 + perfil do usuário logado

5) GET /users/sellers    (Authorization: Bearer <token>)
   mesmo fluxo do item 3 ──► GET /users/sellers ──► 200 + array de sellers ativos

Erro 4xx do users-service ──► repassado ao cliente; sem retry; não conta no circuit breaker
Rede / timeout / 5xx      ──► retry ──► circuit breaker ──► fallback 503
```

---

## 7. Respostas Esperadas (via gateway)

| Rota no gateway               | Cenário                                        | Status esperado                                  |
|-------------------------------|------------------------------------------------|--------------------------------------------------|
| `POST /auth/register`         | Dados válidos, e-mail novo                     | 201 + usuário público                            |
| `POST /auth/register`         | Dados inválidos                                | 400 + mensagens do users-service                 |
| `POST /auth/register`         | E-mail já cadastrado                           | 409 + mensagem do users-service (nunca 401)      |
| `POST /auth/login`            | Credenciais válidas                            | 200 + `user` e `token`                           |
| `POST /auth/login`            | Credenciais inválidas                          | 401 + mensagem do users-service                  |
| `POST /auth/*`                | users-service fora do ar                       | 503 (nunca 401)                                  |
| `GET /auth/validate-token`    | Token válido                                   | 200 + `userId`, `email`, `role`                  |
| `GET /users/profile`          | Token válido                                   | 200 + perfil do dono do token                    |
| `GET /users/sellers`          | Token válido                                   | 200 + array (pode ser vazio)                     |
| `GET /users/:id`              | Token válido, usuário existe                   | 200 + usuário público                            |
| `GET /users/:id`              | Token válido, usuário não existe               | 404 + mensagem do users-service                  |
| `GET /auth/validate-token`, `GET /users/*` | Sem token / token inválido / expirado | 401 (respondido pelo gateway)               |
| `GET /users/*`                | users-service fora do ar                       | 503                                              |
| `GET /health` (gateway)       | users-service no ar                            | `users` = healthy                                |
| `GET /health` (gateway)       | users-service fora do ar                       | `users` = unhealthy, geral degraded              |

---

## 8. Requisitos Não Funcionais

- **RNF-01** — Nenhuma resposta, em nenhum dos dois serviços, pode conter o campo `password` ou seu hash.
- **RNF-02** — O `JWT_SECRET` vem exclusivamente de variável de ambiente nos dois serviços.
- **RNF-03** — Os contratos existentes do users-service (`register`, `login`, `/users/*`) não podem mudar.
- **RNF-04** — Esta spec não exige mudanças no `ProxyService`, no `RetryService`, no `CircuitBreakerService` nem nos módulos de timeout e fallback: a correção de erros 4xx já aplicada é **pré-requisito**. O `JwtAuthGuard`, o `SessionGuard` e o `RoleGuard` não podem ter sua lógica alterada.
- **RNF-05** — Os novos artefatos seguem a organização de pastas já existente em cada serviço. No gateway, o `UsersController`/`UsersModule` espelha o `ProductsController`/`ProductsModule`.
- **RNF-06** — O gateway não ganha dependências novas.

---

## 9. Pontos de Atenção (fora do escopo, registrar para specs futuras)

- **Retry em `POST /auth/register`:** o `ProxyService` repete requisições em erro de rede, timeout ou 5xx, inclusive em `POST`. Se o users-service gravar o usuário e falhar antes de responder, a nova tentativa pode receber **409** mesmo com o registro tendo dado certo. Registrar para uma spec que trate idempotência ou desligue retry em métodos não idempotentes.
- **Latência até o 503:** com o users-service fora do ar, o retry com backoff (até 5 tentativas) faz o cliente esperar vários segundos antes do 503, até o circuito abrir.
- **Circuito compartilhado:** `/auth/*` e `/users/*` usam o mesmo circuito (`proxy-users`). Falhas de infraestrutura em uma rota abrem o circuito para todas as rotas do users-service. É o comportamento esperado (o serviço está indisponível), mas deve ser conhecido.
- **Cache de `GET` por caminho:** o `ProxyService` guarda as respostas `GET` com a chave `serviço + caminho`, sem considerar o usuário. Hoje o fallback de `users` é de erro (503) e não lê esse cache, então não há vazamento. Mas `GET /users/profile` e `GET /auth/validate-token` têm o mesmo caminho para todos os usuários: se um fallback de cache for adicionado ao serviço `users`, ele poderia devolver dados de **outro usuário**. Deve ser tratado em uma spec própria do gateway.
- **Mensagens de validação:** como o gateway deixa de validar o corpo de `register` e `login`, as mensagens de 400 passam a ser as do users-service. Consumidores que dependiam das mensagens antigas do gateway devem ser avisados.
- **Throttle de registro:** o gateway limita `POST /auth/register` a 3 requisições por minuto e `POST /auth/login` a 5; considerar isso ao rodar os testes manuais (inclusive o CA de circuit breaker com logins inválidos em sequência).

---

## 10. Critérios de Aceite

### users-service

- [ ] **CA-01** — `GET /health` sem token retorna 200 com `{ "status": "ok", "service": "users-service" }`.
- [ ] **CA-02** — `GET /health` com token inválido também retorna 200.
- [ ] **CA-03** — `GET /auth/validate-token` com token válido retorna 200 com exatamente `userId`, `email` e `role` do usuário que fez login.
- [ ] **CA-04** — `GET /auth/validate-token` sem token, com token malformado ou expirado retorna 401.
- [ ] **CA-05** — A resposta de `validate-token` não contém `password`, `iat`, `exp` nem `sub`.
- [ ] **CA-06** — `http://localhost:3000/api` abre o Swagger com título "Users Service", versão 1.0, botão "Authorize" (Bearer) e todas as rotas de RF-03.4.
- [ ] **CA-07** — Pelo Swagger, após informar um token no "Authorize", `GET /users/profile` retorna 200.

### api-gateway — estrutura

- [ ] **CA-08** — `.env` contém `USERS_SERVICE_URL=http://localhost:3000` e `JWT_SECRET` igual ao do users-service; `.env.example` documenta ambos sem valores secretos.
- [ ] **CA-09** — Ao iniciar o gateway, os logs mostram `POST /auth/register`, `POST /auth/login`, `GET /auth/validate-token`, `GET /users/profile`, `GET /users/sellers` e `GET /users/:id`, todos mapeados no `UsersController`, sem rotas duplicadas.
- [ ] **CA-10** — O `AuthController` não existe mais, e nenhuma rota do gateway chama o users-service por `HttpService` diretamente (`AuthService` sem `login`/`register`); o `SessionGuard` continua compilando e funcionando.
- [ ] **CA-11** — Toda requisição a `/auth/*` e `/users/*` gera o log `Proxying ... request to users` do `ProxyService`.

### api-gateway — comportamento

- [ ] **CA-12** — `POST /auth/register` com e-mail já cadastrado retorna **409** pelo gateway, com a mesma mensagem da chamada direta ao users-service (não 401 genérico).
- [ ] **CA-13** — `POST /auth/login` com credenciais inválidas retorna **401** com a mensagem real do users-service; com credenciais corretas, retorna **200** com `user` e `token`.
- [ ] **CA-14** — Erros 4xx do users-service chegam ao cliente com **status code e body preservados**: para `register` com corpo inválido (400), e-mail duplicado (409), login inválido (401) e `GET /users/<uuid inexistente>` (404), a resposta pela porta 3005 é idêntica à da porta 3000.
- [ ] **CA-15** — `POST /auth/register` envia ao users-service o corpo exatamente como recebido: sem `role` injetado pelo gateway e sem campos removidos (verificável por teste unitário ou log).
- [ ] **CA-16** — O circuit breaker **não** é acionado por erros 4xx: após 4 logins seguidos com senha errada (acima do `failureThreshold` de 3), cada um respondido com 401, um login com credenciais corretas retorna **200** (não 503), e os logs não mostram `Circuit breaker OPENED for proxy-users` nem tentativas de retry para essas requisições.
- [ ] **CA-17** — Com o users-service parado, `POST /auth/login` no gateway retorna **503** (não 401).
- [ ] **CA-18** — `GET /users/profile` e `GET /auth/validate-token` sem token retornam 401 e os logs do users-service mostram que nenhuma requisição chegou a ele.
- [ ] **CA-19** — `GET /users/profile` e `GET /auth/validate-token` com token válido retornam o mesmo corpo que a chamada direta ao users-service com o mesmo token.
- [ ] **CA-20** — O users-service recebe o header `Authorization` original e os headers `x-user-*` nas rotas protegidas vindas do gateway (verificável por log ou teste).
- [ ] **CA-21** — `GET /users/profile` e `GET /users/sellers` no gateway nunca são tratados como `GET /users/:id`.
- [ ] **CA-22** — Um `:id` com `..` ou `/` codificado não faz o gateway chamar outro caminho do users-service.
- [ ] **CA-23** — `POST /auth/login` mantém o limite de 5 requisições por minuto e `POST /auth/register` o de 3 por minuto.
- [ ] **CA-24** — Health do gateway mostra `users` como healthy com o users-service no ar, e unhealthy/degraded com ele parado.
- [ ] **CA-25** — O Swagger do gateway (`http://localhost:3005/api`) lista as rotas `/auth/*` na tag `Authentication` e `/users/*` na tag `Users`, com Bearer apenas nas rotas protegidas, o corpo de `register` e `login` conforme o contrato do users-service e o corpo correto da resposta de login.
- [ ] **CA-26** — Não há alterações na lógica de `JwtAuthGuard`, `SessionGuard`, `RoleGuard`, nem em `ProxyService`, circuit breaker, retry, timeout e fallback além da correção de 4xx já aplicada.

### Fluxo E2E (curl/Postman, somente pela porta 3005)

Com os dois serviços e o banco no ar:

- [ ] **CA-27** — `POST http://localhost:3005/auth/register` com um seller válido → 201, sem `password`.
- [ ] **CA-28** — Repetir CA-27 com o mesmo e-mail → 409 com a mensagem do users-service.
- [ ] **CA-29** — `POST http://localhost:3005/auth/login` com as mesmas credenciais → 200 com `token`; com senha errada → 401.
- [ ] **CA-30** — `GET http://localhost:3005/auth/validate-token` com `Authorization: Bearer <token>` → 200 com `userId`, `email` e `role` do usuário de CA-27.
- [ ] **CA-31** — `GET http://localhost:3005/users/profile` com o mesmo token → 200 com os dados do usuário registrado em CA-27.
- [ ] **CA-32** — `GET http://localhost:3005/users/sellers` com o mesmo token → 200 com um array contendo o seller registrado (se estiver ativo).
- [ ] **CA-33** — Repetir CA-30 a CA-32 sem token ou com token adulterado → 401.
- [ ] **CA-34** — O passo a passo de CA-27 a CA-33 (comandos curl ou coleção Postman) está documentado no README do gateway ou do users-service.

### Qualidade

- [ ] **CA-35** — users-service: testes unitários de `validate-token` e `health`, e testes e2e cobrindo CA-01 a CA-05.
- [ ] **CA-36** — api-gateway: testes unitários do `UsersController` cobrindo, para cada rota, o serviço `users`, o método e o caminho corretos; corpo intacto em `register` e `login` (sem `userInfo` nem `Authorization`); repasse do `Authorization` e do usuário nas rotas protegidas; propagação, sem conversão, da exceção lançada pelo `ProxyService`; e caminho seguro com `:id` malicioso. Os testes de `login`/`register` do `AuthService` e do `AuthController` são removidos.
- [ ] **CA-37** — Lint, build e testes passam sem erros nos dois serviços.

---

## 11. Processo de Implementação

- Cada etapa deve resultar em um **commit separado**, no repositório do serviço correspondente (users-service e api-gateway são repositórios git distintos). Sugestão de etapas:
  1. users-service — `GET /health`
  2. users-service — `GET /auth/validate-token`
  3. users-service — Swagger
  4. users-service — testes
  5. api-gateway — configuração de ambiente (`.env.example`)
  6. api-gateway — registro da `JwtStrategy` e aceitação do payload do users-service
  7. api-gateway — rotas `/auth/*` e `/users/*` no `UsersController` via `ProxyService` (guard por rota, corpo intacto, throttle e Swagger)
  8. api-gateway — remoção do `AuthController` e de `login`/`register` do `AuthService` (e dos DTOs, se não forem mais usados)
  9. api-gateway — testes
  10. documentação do fluxo E2E
- **Antes de cada commit**, o lint do serviço alterado deve ser executado e passar sem erros.
- Mensagens de commit seguem o padrão já usado em cada repositório (ex.: `feat(health): ...`, `feat(auth): ...`, `refactor(auth): ...`, `test(users): ...`).

---

## 12. Fora de Escopo (reforço)

- Não alterar a lógica dos guards do gateway.
- Não implementar session management.
- Não implementar autorização por role nas rotas de usuários.
- Não integrar products, checkout ou payments.
