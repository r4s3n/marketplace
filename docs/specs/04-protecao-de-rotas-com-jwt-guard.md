# SPEC — Proteção de Rotas com JWT (JwtStrategy, JwtAuthGuard e @Public)

**Serviço:** users-service
**Projeto:** marketplace-ms
**Status:** Proposta
**Data:** 2026-10-10

---

## 1. Contexto

O users-service já possui:

- NestJS + PostgreSQL com a entidade `User`
- `POST /auth/register` e `POST /auth/login` funcionando, com geração de JWT
- `JwtModule` configurado no `AuthModule` (secret via variável de ambiente, expiração de 24h)
- Dependências `@nestjs/passport`, `passport` e `passport-jwt` já instaladas

Hoje, qualquer rota do serviço pode ser acessada sem autenticação. Esta spec define a proteção das rotas para que apenas usuários autenticados com um JWT válido possam acessá-las, mantendo públicas apenas as rotas explicitamente marcadas como tal.

## 2. Objetivo

Tornar todas as rotas do users-service **protegidas por padrão** (secure by default), exigindo um JWT válido, com um mecanismo explícito para declarar exceções públicas.

## 3. Escopo

### Dentro do escopo

- Estratégia de autenticação JWT (JwtStrategy) baseada em Passport
- Guard de autenticação JWT (JwtAuthGuard) registrado globalmente
- Decorator `@Public()` para marcar rotas que dispensam autenticação
- Marcação de `POST /auth/register` e `POST /auth/login` como públicas

### Fora do escopo

- RoleGuard / autorização por perfil (role)
- SessionGuard / controle de sessão
- Criação de novos endpoints (ex.: `GET /users/me`) — virá na próxima spec
- Refresh token, revogação de token ou blacklist
- Alterações na geração do token, no payload emitido ou no tempo de expiração

---

## 4. Requisitos Funcionais

### RF-01 — JwtStrategy (Passport)

O serviço deve possuir uma estratégia de autenticação JWT registrada no Passport que:

1. **RF-01.1** — Extraia o token do header `Authorization`, exclusivamente no formato `Bearer <token>`.
2. **RF-01.2** — Valide automaticamente a assinatura do token usando o mesmo secret configurado no `JwtModule` (lido de variável de ambiente, nunca fixo no código).
3. **RF-01.3** — Valide automaticamente a expiração do token, **rejeitando** tokens expirados (a expiração não deve ser ignorada).
4. **RF-01.4** — Ao validar com sucesso, produza um objeto de usuário autenticado contendo **apenas**:
   - `id` — identificador do usuário (proveniente do payload do token)
   - `email` — e-mail do usuário
   - `role` — perfil do usuário
5. **RF-01.5** — Esse objeto deve ficar disponível em `req.user` em todas as rotas protegidas.
6. **RF-01.6** — Os dados de `req.user` devem ser obtidos a partir do payload do token, sem consulta ao banco de dados.
7. **RF-01.7** — Os campos do objeto retornado devem corresponder aos campos que o `AuthService` já inclui no payload no momento do login. Caso o payload atual use outro nome para o identificador (ex.: `sub`), a estratégia deve mapeá-lo para `id`.

### RF-02 — JwtAuthGuard

O serviço deve possuir um guard de autenticação JWT que:

1. **RF-02.1** — Seja baseado no `AuthGuard` do Passport, utilizando a estratégia `jwt` definida em RF-01.
2. **RF-02.2** — Antes de exigir autenticação, verifique se a rota (handler) ou o controller (classe) possui o metadata `isPublic`.
3. **RF-02.3** — Se a rota for pública, permita o acesso **sem exigir token**.
4. **RF-02.4** — Se a rota não for pública, delegue a validação do token à JwtStrategy.
5. **RF-02.5** — Em caso de falha de autenticação, responda com **HTTP 401 Unauthorized**.
6. **RF-02.6** — Seja registrado como **guard global** via `APP_GUARD`, de modo que toda rota existente ou futura seja protegida automaticamente, sem necessidade de declarar o guard em cada controller.

### RF-03 — Decorator @Public()

1. **RF-03.1** — Deve existir um decorator `@Public()` que marca uma rota como pública.
2. **RF-03.2** — O decorator deve utilizar o mecanismo de metadata do NestJS, definindo a chave `isPublic` com valor verdadeiro.
3. **RF-03.3** — A chave de metadata deve ser definida em um único local e reutilizada tanto pelo decorator quanto pelo guard (sem strings duplicadas).
4. **RF-03.4** — O decorator deve poder ser aplicado em um método (rota específica) ou em um controller inteiro (todas as rotas da classe).

### RF-04 — Rotas públicas existentes

As seguintes rotas devem ser marcadas com `@Public()` e continuar funcionando exatamente como hoje, sem exigir token:

| Método | Rota             |
|--------|------------------|
| POST   | `/auth/register` |
| POST   | `/auth/login`    |

Nenhuma outra rota deve ser marcada como pública nesta spec.

---

## 5. Fluxo Esperado de uma Requisição

```
Requisição HTTP
   │
   ▼
JwtAuthGuard (global)
   │
   ├── Rota possui metadata isPublic? ── SIM ──► Controller processa (sem req.user)
   │
   NÃO
   │
   ▼
JwtStrategy
   │
   ├── Header Authorization ausente ou fora do formato Bearer ──► 401
   ├── Assinatura inválida ───────────────────────────────────► 401
   ├── Token expirado ────────────────────────────────────────► 401
   │
   VÁLIDO
   │
   ▼
req.user = { id, email, role }
   │
   ▼
Controller processa a requisição
```

---

## 6. Respostas Esperadas (rotas protegidas)

| Cenário                                                     | Status esperado        |
|-------------------------------------------------------------|------------------------|
| Header `Authorization` ausente                              | 401 Unauthorized       |
| Header presente sem o prefixo `Bearer` (ex.: só o token)    | 401 Unauthorized       |
| `Bearer` sem token                                          | 401 Unauthorized       |
| Token malformado (não é um JWT)                             | 401 Unauthorized       |
| Token assinado com secret diferente                         | 401 Unauthorized       |
| Token com payload adulterado (assinatura não confere)       | 401 Unauthorized       |
| Token expirado                                              | 401 Unauthorized       |
| Token válido                                                | Resposta normal da rota |

**Requisitos da resposta 401:**

- Deve seguir o formato padrão de erro do NestJS (`statusCode`, `message`).
- Não deve expor detalhes internos (stack trace, secret, motivo técnico detalhado da falha da biblioteca).

---

## 7. Requisitos Não Funcionais

- **RNF-01** — O secret do JWT deve vir exclusivamente de variável de ambiente; nenhum valor de secret pode existir no código.
- **RNF-02** — A validação do token não deve acessar o banco de dados (stateless).
- **RNF-03** — Os novos artefatos (strategy, guard, decorator) devem ficar organizados dentro do módulo de autenticação, seguindo a estrutura de pastas já existente no serviço.
- **RNF-04** — Comportamento das rotas públicas existentes (contratos de request/response de register e login) não pode ser alterado.

---

## 8. Critérios de Aceite

### Rotas públicas

- [ ] **CA-01** — `POST /auth/register` sem header `Authorization` cria o usuário normalmente (mesmo status e corpo de antes).
- [ ] **CA-02** — `POST /auth/login` sem header `Authorization` retorna o token normalmente (mesmo status e corpo de antes).
- [ ] **CA-03** — `POST /auth/register` e `POST /auth/login` continuam funcionando mesmo quando é enviado um token inválido ou expirado no header.

### Proteção global

- [ ] **CA-04** — Qualquer rota existente **não** marcada com `@Public()` retorna 401 quando acessada sem token.
- [ ] **CA-05** — O guard está registrado globalmente via `APP_GUARD`; nenhum controller precisa declarar o guard individualmente para ser protegido.
- [ ] **CA-06** — Uma rota nova criada sem `@Public()` é protegida automaticamente (verificável em teste com um controller de teste).

### Validação do token

- [ ] **CA-07** — Requisição a rota protegida sem header `Authorization` → 401.
- [ ] **CA-08** — Requisição com header sem prefixo `Bearer` → 401.
- [ ] **CA-09** — Requisição com token assinado por outro secret → 401.
- [ ] **CA-10** — Requisição com token expirado → 401.
- [ ] **CA-11** — Requisição com token malformado → 401.
- [ ] **CA-12** — Requisição com token válido obtido em `POST /auth/login` → acesso concedido.

### Dados do usuário autenticado

- [ ] **CA-13** — Com token válido, `req.user` contém exatamente `id`, `email` e `role`, com valores iguais aos do usuário que fez login.
- [ ] **CA-14** — `req.user` não contém dados sensíveis (ex.: senha/hash) nem campos técnicos do token (ex.: `iat`, `exp`).

### Decorator

- [ ] **CA-15** — `@Public()` aplicado em um método torna apenas aquela rota pública.
- [ ] **CA-16** — `@Public()` aplicado em um controller torna todas as rotas da classe públicas.
- [ ] **CA-17** — A chave `isPublic` é definida em um único lugar e reutilizada pelo decorator e pelo guard.

### Qualidade

- [ ] **CA-18** — Existem testes unitários cobrindo: guard (rota pública vs. protegida) e strategy (retorno de `id`, `email`, `role`).
- [ ] **CA-19** — Existem testes e2e cobrindo os cenários da seção 6.
- [ ] **CA-20** — Lint e build passam sem erros.

---

## 9. Processo de Implementação

- Cada etapa da implementação (strategy, decorator, guard, registro global, marcação das rotas públicas, testes) deve resultar em um **commit separado**.
- **Antes de cada commit**, o lint do users-service deve ser executado e passar sem erros.
- Mensagens de commit devem descrever de forma objetiva a etapa implementada.

---

## 10. Fora de Escopo (reforço)

- Não implementar RoleGuard.
- Não implementar SessionGuard.
- Não criar novos endpoints (ex.: perfil do usuário autenticado) — será tratado na próxima spec.
