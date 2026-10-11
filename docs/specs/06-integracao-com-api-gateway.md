# SPEC — Integração do users-service com o api-gateway

**Serviços:** users-service e api-gateway
**Projeto:** marketplace-ms
**Status:** Proposta
**Data:** 2026-10-11

---

## 1. Contexto

O **users-service** (porta 3000) já possui:

- `POST /auth/register` e `POST /auth/login` (públicos), com emissão de JWT cujo payload contém `sub`, `email` e `role` (spec 03)
- `JwtAuthGuard` global e decorator `@Public()`; usuário autenticado disponível em `req.user` com `id`, `email` e `role` (spec 04)
- `GET /users/profile`, `GET /users/sellers` e `GET /users/:id`, todos protegidos (spec 05)
- Não possui endpoint de health, endpoint de validação de token nem documentação Swagger

O **api-gateway** (porta 3005) já possui:

- `ProxyService` com circuit breaker, retry, timeout e fallback, capaz de encaminhar requisições ao serviço `users` repassando headers e informações do usuário (`x-user-id`, `x-user-email`, `x-user-role`)
- `JwtStrategy` e `JwtAuthGuard` (Passport), `SessionGuard` e `RoleGuard`
- `AuthController` com `POST /auth/login` e `POST /auth/register`, que chamam o users-service via `AuthService`
- Health check que consulta `GET {url}/health` de cada serviço configurado
- Swagger em `/api`
- `serviceConfig.users.url` lido de `USERS_SERVICE_URL`

### Lacunas identificadas no estado atual

Uma análise do código mostrou que, hoje, o fluxo ponta a ponta **não funciona**, pelos motivos abaixo. Cada lacuna é tratada por um requisito desta spec:

| # | Lacuna | Tratada em |
|---|--------|------------|
| L1 | O users-service não expõe `GET /health`; o gateway sempre o considera indisponível | RF-02 |
| L2 | O `AuthService` do gateway chama `{USERS_SERVICE_URL}/login` em vez de `/auth/login` | RF-05 |
| L3 | O gateway converte qualquer erro do users-service em 401 (ex.: e-mail duplicado no registro vira 401 em vez de 409) | RF-05 |
| L4 | Não existe nenhuma rota no gateway para `/users/*`; o `ProxyService` existe, mas nenhum controller o utiliza | RF-06 |
| L5 | A `JwtStrategy` do gateway não está registrada como provider, e o `JwtAuthGuard` não é aplicado a nenhuma rota | RF-07 |
| L6 | O `JWT_SECRET` do gateway é um valor de exemplo, diferente do usado pelo users-service; nenhum token emitido pelo users-service seria aceito | RF-04 |
| L7 | A `JwtStrategy` do gateway tenta revalidar um campo `token` que não existe no payload emitido pelo users-service, o que faz toda validação falhar | RF-07 |

## 2. Objetivo

Permitir que um cliente use **apenas o api-gateway (porta 3005)** para se registrar, fazer login e consultar perfil e vendedores, com o gateway validando o JWT e encaminhando as requisições ao users-service, além de deixar o users-service observável (health) e documentado (Swagger).

## 3. Escopo

### Dentro do escopo

**users-service**
- `GET /auth/validate-token`
- `GET /health`
- Documentação Swagger/OpenAPI em `/api`

**api-gateway**
- Configuração de `USERS_SERVICE_URL` e `JWT_SECRET`
- Correção dos caminhos e do tratamento de erro de `POST /auth/login` e `POST /auth/register`
- Exposição de `GET /users/profile`, `GET /users/sellers` e `GET /users/:id`, encaminhados pelo `ProxyService` existente
- Ativação da validação JWT nas rotas de usuários, usando a `JwtStrategy` e o `JwtAuthGuard` existentes

### Fora do escopo

- Qualquer alteração no mecanismo do `ProxyService` (circuit breaker, retry, timeout, fallback, cache)
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

### RF-05 — Rotas de autenticação (POST /auth/register e POST /auth/login)

1. **RF-05.1** — `POST /auth/register` no gateway deve encaminhar o corpo, sem alterações, para `POST {USERS_SERVICE_URL}/auth/register`.
2. **RF-05.2** — `POST /auth/login` no gateway deve encaminhar o corpo, sem alterações, para `POST {USERS_SERVICE_URL}/auth/login` (corrige L2).
3. **RF-05.3** — As duas rotas continuam **públicas** no gateway.
4. **RF-05.4** — Em caso de sucesso, o gateway devolve ao cliente **o mesmo status e o mesmo corpo** retornados pelo users-service (`201` com o usuário público no registro; `200` com `user` e `token` no login). O gateway não acrescenta, renomeia nem remove campos.
5. **RF-05.5** — Em caso de erro de negócio, o gateway deve **preservar o status e a mensagem** retornados pelo users-service (corrige L3):
   - `400` — dados inválidos
   - `409` — e-mail já cadastrado
   - `401` — credenciais inválidas
6. **RF-05.6** — Se o users-service estiver indisponível ou não responder no tempo limite, o gateway responde com erro de indisponibilidade (`503 Service Unavailable` ou `504 Gateway Timeout`), nunca `401`.
7. **RF-05.7** — Mensagens de erro devolvidas ao cliente não devem expor detalhes internos (URL do serviço, stack trace, objeto de erro do cliente HTTP).
8. **RF-05.8** — A documentação Swagger do gateway para `POST /auth/login` deve refletir o corpo real retornado pelo users-service (`user` e `token`), removendo menções a campos que não existem.
9. **RF-05.9** — Os limites de requisição (`@Throttle`) já configurados nessas rotas são mantidos.

### RF-06 — Rotas de usuários no gateway

1. **RF-06.1** — O gateway deve expor as rotas abaixo, encaminhando cada uma ao users-service pelo **`ProxyService` existente** (serviço `users`), mantendo método e caminho:

   | Rota no gateway (3005) | Destino no users-service (3000) |
   |------------------------|---------------------------------|
   | `GET /users/profile`   | `GET /users/profile`            |
   | `GET /users/sellers`   | `GET /users/sellers`            |
   | `GET /users/:id`       | `GET /users/:id`                |

2. **RF-06.2** — O header `Authorization` recebido pelo gateway deve ser **repassado intacto** ao users-service em todas essas rotas, pois o users-service também valida o token.
3. **RF-06.3** — Os dados do usuário autenticado pelo gateway (`userId`, `email`, `role`) devem ser repassados ao `ProxyService`, que já os envia como headers `x-user-*`.
4. **RF-06.4** — O gateway devolve ao cliente o corpo retornado pelo users-service, sem transformação.
5. **RF-06.5** — As rotas estáticas (`profile`, `sellers`) devem ser declaradas antes da dinâmica (`:id`) no gateway, para que `profile` e `sellers` nunca sejam tratados como ID.
6. **RF-06.6** — As rotas devem aparecer no Swagger do gateway (tag `Users`), marcadas como exigindo Bearer Auth.
7. **RF-06.7** — As rotas devem ficar em um módulo/controller próprio de usuários no gateway, seguindo a organização de pastas existente, e importar o `ProxyModule` sem alterá-lo.

### RF-07 — Validação do JWT no gateway

1. **RF-07.1** — As rotas de RF-06 devem ser protegidas pelo **`JwtAuthGuard` existente** do gateway. Requisições sem token ou com token inválido/expirado são rejeitadas com **401** pelo próprio gateway, **sem** chamar o users-service.
2. **RF-07.2** — A `JwtStrategy` existente deve estar registrada como provider no módulo de autenticação do gateway, para que o guard funcione (corrige L5).
3. **RF-07.3** — A `JwtStrategy` deve aceitar tokens emitidos pelo users-service, cujo payload contém `sub`, `email` e `role`, e produzir o usuário autenticado `{ userId, email, role }` (corrige L7). A verificação de assinatura e expiração continua sendo feita pelo Passport com o `JWT_SECRET` compartilhado; nenhum campo inexistente no payload pode ser exigido.
4. **RF-07.4** — A lógica do `JwtAuthGuard` (verificação de `isPublic` e tratamento de erro) **não** deve ser alterada.
5. **RF-07.5** — As rotas `POST /auth/register`, `POST /auth/login`, os health checks e o Swagger do gateway continuam acessíveis sem token.
6. **RF-07.6** — O `SessionGuard` não deve ser aplicado a nenhuma rota desta spec.

### RF-08 — Health check do users-service no gateway

1. **RF-08.1** — Com o users-service no ar, o health do gateway deve reportar o serviço `users` como **healthy**, consultando o `GET /health` criado em RF-02.
2. **RF-08.2** — Com o users-service fora do ar, o health do gateway deve reportar `users` como **unhealthy** e o status geral como **degraded**, sem derrubar o gateway.
3. **RF-08.3** — O mecanismo de health check do gateway não deve ser alterado.

---

## 6. Fluxo Esperado (via gateway, porta 3005)

```
Cliente ──► api-gateway :3005 ──► users-service :3000

1) POST /auth/register   (público)
   gateway ──► POST /auth/register ──► 201 + usuário público

2) POST /auth/login      (público)
   gateway ──► POST /auth/login    ──► 200 + { user, token }

3) GET /users/profile    (Authorization: Bearer <token>)
   gateway: JwtAuthGuard valida token ── inválido ──► 401 (não chama o users-service)
        │ válido
        ▼
   ProxyService (repasse do Authorization + x-user-*) ──► GET /users/profile
        ──► 200 + perfil do usuário logado

4) GET /users/sellers    (Authorization: Bearer <token>)
   mesmo fluxo do item 3 ──► GET /users/sellers ──► 200 + array de sellers ativos
```

---

## 7. Respostas Esperadas (via gateway)

| Rota no gateway          | Cenário                                        | Status esperado                 |
|--------------------------|------------------------------------------------|---------------------------------|
| `POST /auth/register`    | Dados válidos, e-mail novo                     | 201 + usuário público           |
| `POST /auth/register`    | Dados inválidos                                | 400                             |
| `POST /auth/register`    | E-mail já cadastrado                           | 409                             |
| `POST /auth/login`       | Credenciais válidas                            | 200 + `user` e `token`          |
| `POST /auth/login`       | Credenciais inválidas                          | 401                             |
| `POST /auth/*`           | users-service fora do ar                       | 503 ou 504                      |
| `GET /users/profile`     | Token válido                                   | 200 + perfil do dono do token   |
| `GET /users/sellers`     | Token válido                                   | 200 + array (pode ser vazio)    |
| `GET /users/:id`         | Token válido, usuário existe                   | 200 + usuário público           |
| `GET /users/*`           | Sem token / token inválido / expirado          | 401 (respondido pelo gateway)   |
| `GET /health` (gateway)  | users-service no ar                            | `users` = healthy               |
| `GET /health` (gateway)  | users-service fora do ar                       | `users` = unhealthy, geral degraded |

---

## 8. Requisitos Não Funcionais

- **RNF-01** — Nenhuma resposta, em nenhum dos dois serviços, pode conter o campo `password` ou seu hash.
- **RNF-02** — O `JWT_SECRET` vem exclusivamente de variável de ambiente nos dois serviços.
- **RNF-03** — Os contratos existentes do users-service (`register`, `login`, `/users/*`) não podem mudar.
- **RNF-04** — O `ProxyService`, o `JwtAuthGuard`, o `SessionGuard`, o `RoleGuard` e os módulos de circuit breaker, retry, timeout e fallback do gateway não podem ter sua lógica alterada.
- **RNF-05** — Os novos artefatos seguem a organização de pastas já existente em cada serviço.

---

## 9. Pontos de Atenção (fora do escopo, registrar para specs futuras)

- **Cache de fallback por caminho:** o `ProxyService` guarda respostas `GET` por `serviço + caminho`. Para `GET /users/profile`, isso significa que, se o users-service cair, o fallback pode devolver o perfil de **outro usuário**. Deve ser tratado em uma spec própria do gateway.
- **Retry e circuit breaker em erros 4xx:** o `ProxyService` hoje trata qualquer erro como falha (inclusive `401` e `404` do users-service), aplicando retry e contando para abrir o circuito. Por isso, erros de negócio em `/users/*` podem chegar ao cliente como erro de indisponibilidade. Fora do escopo por não podermos alterar o proxy.
- **Throttle de registro:** o gateway limita `POST /auth/register` a 3 requisições por minuto; considerar isso ao rodar os testes manuais.

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

### api-gateway

- [ ] **CA-08** — `.env` contém `USERS_SERVICE_URL=http://localhost:3000` e `JWT_SECRET` igual ao do users-service; `.env.example` documenta ambos sem valores secretos.
- [ ] **CA-09** — `GET /users/profile` sem token no gateway retorna 401 e os logs do users-service mostram que nenhuma requisição chegou a ele.
- [ ] **CA-10** — `GET /users/profile` com token válido no gateway retorna o mesmo corpo que a chamada direta ao users-service com o mesmo token.
- [ ] **CA-11** — O users-service recebe o header `Authorization` original nas requisições vindas do gateway (verificável por log ou teste).
- [ ] **CA-12** — `GET /users/profile` e `GET /users/sellers` no gateway nunca são tratados como `GET /users/:id`.
- [ ] **CA-13** — `POST /auth/register` com e-mail já existente retorna 409 pelo gateway (não 401).
- [ ] **CA-14** — `POST /auth/login` com senha errada retorna 401 pelo gateway; com credenciais corretas, retorna 200 com `user` e `token`.
- [ ] **CA-15** — Com o users-service parado, `POST /auth/login` no gateway retorna 503 ou 504 (não 401).
- [ ] **CA-16** — Health do gateway mostra `users` como healthy com o users-service no ar, e unhealthy/degraded com ele parado.
- [ ] **CA-17** — O Swagger do gateway (`http://localhost:3005/api`) lista as rotas `/users/*` com Bearer Auth e o corpo correto de login.
- [ ] **CA-18** — Não há alterações na lógica de `ProxyService`, `JwtAuthGuard`, `SessionGuard`, `RoleGuard`, circuit breaker, retry, timeout e fallback.

### Fluxo E2E (curl/Postman, somente pela porta 3005)

Com os dois serviços e o banco no ar:

- [ ] **CA-19** — `POST http://localhost:3005/auth/register` com um seller válido → 201, sem `password`.
- [ ] **CA-20** — `POST http://localhost:3005/auth/login` com as mesmas credenciais → 200 com `token`.
- [ ] **CA-21** — `GET http://localhost:3005/users/profile` com `Authorization: Bearer <token>` → 200 com os dados do usuário registrado em CA-19.
- [ ] **CA-22** — `GET http://localhost:3005/users/sellers` com o mesmo token → 200 com um array contendo o seller registrado (se estiver ativo).
- [ ] **CA-23** — Repetir CA-21 e CA-22 sem token ou com token adulterado → 401.
- [ ] **CA-24** — O passo a passo de CA-19 a CA-23 (comandos curl ou coleção Postman) está documentado no README do gateway ou do users-service.

### Qualidade

- [ ] **CA-25** — users-service: testes unitários de `validate-token` e `health`, e testes e2e cobrindo CA-01 a CA-05.
- [ ] **CA-26** — api-gateway: testes unitários do controller de usuários (encaminhamento ao `ProxyService` com caminho, `Authorization` e dados do usuário) e do `AuthService` (caminhos corretos e preservação de status de erro).
- [ ] **CA-27** — Lint, build e testes passam sem erros nos dois serviços.

---

## 11. Processo de Implementação

- Cada etapa deve resultar em um **commit separado**, no repositório do serviço correspondente (users-service e api-gateway são repositórios git distintos). Sugestão de etapas:
  1. users-service — `GET /health`
  2. users-service — `GET /auth/validate-token`
  3. users-service — Swagger
  4. users-service — testes
  5. api-gateway — configuração de ambiente (`.env.example`)
  6. api-gateway — correção de caminhos e erros em `/auth/*`
  7. api-gateway — registro da `JwtStrategy` e aceitação do payload do users-service
  8. api-gateway — rotas `/users/*` via `ProxyService`
  9. api-gateway — testes
  10. documentação do fluxo E2E
- **Antes de cada commit**, o lint do serviço alterado deve ser executado e passar sem erros.
- Mensagens de commit seguem o padrão já usado em cada repositório (ex.: `feat(health): ...`, `feat(auth): ...`, `test(users): ...`).

---

## 12. Fora de Escopo (reforço)

- Não alterar o mecanismo de proxy (circuit breaker, retry, timeout, fallback, cache) do gateway.
- Não alterar a lógica dos guards do gateway.
- Não implementar session management.
- Não implementar autorização por role nas rotas de usuários.
- Não integrar products, checkout ou payments.
