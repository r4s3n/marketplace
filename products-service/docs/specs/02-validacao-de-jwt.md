# SPEC: Validação de JWT no products-service

| Campo        | Valor                                          |
| ------------ | ---------------------------------------------- |
| Serviço      | products-service                               |
| Sistema      | marketplace-ms                                 |
| Tipo         | Autenticação / proteção de rotas               |
| Status       | Pronta para planejamento                       |
| Data         | 2026-10-12                                     |
| Depende de   | `01-scaffold.md` (products-service) e specs 03 e 04 do users-service |

---

## 1. Objetivo

Proteger todas as rotas do **products-service** com autenticação JWT, aceitando **apenas** tokens emitidos pelo users-service. Ao final desta spec, toda rota do serviço exige um token válido por padrão (secure by default), com um mecanismo explícito para declarar rotas públicas, e os dados do usuário autenticado ficam disponíveis em `req.user`.

O products-service **não emite tokens**. Ele só valida tokens que já foram emitidos pelo users-service no login.

## 2. Contexto no sistema

| Serviço              | Porta app | Papel no JWT                                              |
| -------------------- | --------- | --------------------------------------------------------- |
| users-service        | 3000      | **Emite** o token no login (`POST /auth/login`) e também o valida nas próprias rotas. |
| **products-service** | **3001**  | **Apenas valida** o token. Não tem login, registro nem emissão. |

- O users-service assina o token com o `JWT_SECRET` e define a expiração (24h hoje).
- O payload emitido pelo users-service é: `sub` (UUID do usuário), `email` e `role` (`seller` ou `buyer`), além dos campos técnicos `iat` e `exp` que a assinatura acrescenta.
- O `JWT_SECRET` é **o mesmo valor** nos dois serviços. É isso que permite ao products-service conferir a assinatura sem chamar o users-service.
- A validação é **stateless**: o products-service não consulta o users-service nem o banco para validar o token.

## 3. Padrões a seguir (copiar a abordagem do users-service)

A implementação deve ser uma cópia da abordagem já adotada na spec `04-protecao-de-rotas-com-jwt-guard.md` do users-service, com as mesmas decisões:

- Mesma organização de pastas dentro de `src/auth/` (estratégia, guard, decorator e interfaces em subpastas próprias, com os mesmos nomes de arquivo).
- Mesmos nomes de classes, decorator e chave de metadata (`JwtStrategy`, `JwtAuthGuard`, `@Public()`, `isPublic`).
- Mesmo formato de `req.user` (`id`, `email`, `role`).
- Mesma forma de ler o secret (variável de ambiente obrigatória, sem valor padrão).
- Mesmas versões das bibliotecas usadas no users-service.
- Mesmo estilo de testes unitários e e2e (incluindo o uso de controllers de teste no e2e para provar a proteção global).
- Comentários curtos em português, como no restante do código.

Diferenças em relação ao users-service (por causa do papel do serviço):

- **Não** existe `AuthController` nem `AuthService`.
- **Não** existe configuração de emissão de token (tempo de expiração, opções de assinatura).
- **Não** há rotas de login ou registro para marcar como públicas.

## 4. Requisitos funcionais

### RF-01: Dependências do projeto

O products-service deve declarar as dependências necessárias para validar JWT com Passport:

- runtime: `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`;
- desenvolvimento: tipagens do `passport-jwt` e o que mais os testes precisarem para seguir o mesmo estilo dos testes do users-service.

As versões devem ser **exatamente** as mesmas declaradas no `package.json` do users-service. Nenhuma outra dependência deve ser adicionada nesta etapa.

### RF-02: Variável de ambiente `JWT_SECRET`

1. **RF-02.1** — O secret usado para validar o token deve vir **exclusivamente** da variável de ambiente `JWT_SECRET`. Nenhum valor de secret pode estar escrito no código.
2. **RF-02.2** — O valor em desenvolvimento deve ser **idêntico** ao `JWT_SECRET` do users-service.
3. **RF-02.3** — Se `JWT_SECRET` não estiver definida, a aplicação **não deve iniciar** e deve mostrar um erro claro no console (mesmo comportamento do users-service, sem valor padrão).
4. **RF-02.4** — A chave `JWT_SECRET` deve ser adicionada ao `.env.example` (sem valor) e ao `.env` local.

### RF-03: Contratos de dados do token

1. **RF-03.1** — Deve existir uma definição de tipo para o **payload do token** com os campos `sub`, `email` e `role`, igual à do users-service.
2. **RF-03.2** — Deve existir uma definição de tipo para o **usuário autenticado** (`req.user`) com os campos `id`, `email` e `role`, igual à do users-service.
3. **RF-03.3** — Os valores de `role` devem ser representados por um enum local do products-service com exatamente os valores `seller` e `buyer`, os mesmos do users-service. O products-service **não** importa código do users-service (são projetos separados).
4. **RF-03.4** — Esses tipos devem ficar dentro do módulo de autenticação.

### RF-04: JwtStrategy

O serviço deve ter uma estratégia JWT registrada no Passport que:

1. **RF-04.1** — Extraia o token **apenas** do header `Authorization`, no formato `Bearer <token>`.
2. **RF-04.2** — Valide automaticamente a **assinatura** do token com o `JWT_SECRET` (RF-02).
3. **RF-04.3** — Valide automaticamente a **expiração**, rejeitando tokens expirados. A expiração não pode ser ignorada.
4. **RF-04.4** — Depois de validar, monte o usuário autenticado mapeando `sub` → `id`, e repassando `email` e `role`.
5. **RF-04.5** — O usuário autenticado deve conter **apenas** `id`, `email` e `role`. Campos técnicos do token (`iat`, `exp`) e qualquer outro campo do payload não devem aparecer em `req.user`.
6. **RF-04.6** — A validação não acessa banco de dados nem faz chamadas a outros serviços.
7. **RF-04.7** — A estratégia **não** restringe acesso por role: tokens de `seller` e de `buyer` são igualmente válidos.

### RF-05: JwtAuthGuard

O serviço deve ter um guard de autenticação que:

1. **RF-05.1** — Seja baseado no guard do Passport, usando a estratégia `jwt` do RF-04.
2. **RF-05.2** — Antes de exigir o token, verifique se o método (rota) ou a classe (controller) tem o metadata `isPublic`. A marcação do método tem prioridade sobre a do controller.
3. **RF-05.3** — Em rota pública, libere o acesso **sem olhar** o header `Authorization` (um token inválido ou expirado enviado para uma rota pública não causa erro).
4. **RF-05.4** — Em rota não pública, delegue a validação à JwtStrategy.
5. **RF-05.5** — Em qualquer falha de autenticação, responda **HTTP 401 Unauthorized**.
6. **RF-05.6** — Seja registrado como **guard global** via `APP_GUARD`, de modo que toda rota existente ou futura fique protegida sem precisar declarar o guard em cada controller.

### RF-06: Decorator `@Public()`

1. **RF-06.1** — Deve existir um decorator `@Public()` que marca uma rota como pública, usando o mecanismo de metadata do NestJS com a chave `isPublic` e valor verdadeiro.
2. **RF-06.2** — A chave `isPublic` deve ser definida em **um único lugar** e reutilizada pelo decorator e pelo guard.
3. **RF-06.3** — O decorator deve funcionar aplicado em um método (só aquela rota fica pública) ou em um controller (todas as rotas da classe ficam públicas).

### RF-07: AuthModule

1. **RF-07.1** — Deve existir um módulo `auth` que reúne a estratégia, o guard global e o suporte do Passport.
2. **RF-07.2** — O módulo deve ser registrado no módulo raiz da aplicação.
3. **RF-07.3** — O módulo **não** deve ter controllers nem expor rotas.
4. **RF-07.4** — O módulo **não** deve configurar emissão de tokens (sem tempo de expiração e sem opções de assinatura). O products-service não gera tokens em código de produção.
5. **RF-07.5** — O `@nestjs/jwt` é usado nos testes para gerar tokens com o mesmo formato e secret do users-service (válidos, expirados, assinados com outro secret).

### RF-08: Rotas existentes

1. **RF-08.1** — A rota `GET /` já existente (gerada pelo CLI) **não** deve ser marcada como pública. Ela passa a exigir token, como acontece no users-service.
2. **RF-08.2** — O teste e2e existente dessa rota deve ser ajustado para o novo comportamento (sem token → 401).
3. **RF-08.3** — Nenhuma rota deve ser marcada com `@Public()` nesta spec.
4. **RF-08.4** — Nenhuma rota de autenticação (`/auth/login`, `/auth/register` ou similar) deve existir no products-service.

## 5. Fluxo esperado de uma requisição

```
Requisição HTTP → products-service
   │
   ▼
JwtAuthGuard (global)
   │
   ├── Rota ou controller com isPublic? ── SIM ──► Controller processa (sem req.user)
   │
   NÃO
   │
   ▼
JwtStrategy
   │
   ├── Header Authorization ausente ou fora do formato Bearer ──► 401
   ├── Assinatura inválida (outro secret ou payload adulterado) ─► 401
   ├── Token expirado ──────────────────────────────────────────► 401
   │
   VÁLIDO
   │
   ▼
req.user = { id, email, role }
   │
   ▼
Controller processa a requisição
```

## 6. Respostas esperadas (rotas protegidas)

| Cenário                                                     | Status esperado         |
| ----------------------------------------------------------- | ----------------------- |
| Header `Authorization` ausente                              | 401 Unauthorized        |
| Header presente sem o prefixo `Bearer` (só o token)         | 401 Unauthorized        |
| Prefixo `Bearer` sem token                                  | 401 Unauthorized        |
| Token malformado (não é um JWT)                             | 401 Unauthorized        |
| Token assinado com secret diferente                         | 401 Unauthorized        |
| Token com payload adulterado (assinatura não confere)       | 401 Unauthorized        |
| Token expirado                                              | 401 Unauthorized        |
| Token válido de um `seller`                                 | Resposta normal da rota |
| Token válido de um `buyer`                                  | Resposta normal da rota |

Requisitos da resposta 401:

- Formato padrão de erro do NestJS (`statusCode` e `message`), igual ao do users-service.
- Sem detalhes internos: sem stack trace, sem o secret e sem o motivo técnico da falha devolvido pela biblioteca (por exemplo, "jwt expired" ou "invalid signature").

## 7. Requisitos não funcionais

- **RNF-01** — Nenhum secret no código-fonte; só na variável de ambiente.
- **RNF-02** — Validação stateless: sem banco e sem chamadas HTTP para validar o token.
- **RNF-03** — Os arquivos de autenticação ficam dentro de `src/auth/`, na mesma estrutura do users-service.
- **RNF-04** — O comportamento de inicialização já existente (porta, conexão com o banco, ValidationPipe, CORS) não muda.

## 8. Estrutura de pastas esperada (alto nível)

```
products-service/
├── docs/specs/02-validacao-de-jwt.md
├── .env / .env.example       → + JWT_SECRET
├── src/
│   ├── auth/
│   │   ├── auth.module
│   │   ├── strategies/       → JwtStrategy
│   │   ├── guards/           → JwtAuthGuard
│   │   ├── decorators/       → @Public() e chave isPublic
│   │   ├── interfaces/       → payload do token e usuário autenticado
│   │   └── enums/            → roles (seller, buyer)
│   ├── products/
│   ├── config/
│   ├── app.module            → registra o AuthModule
│   └── main
└── test/
    └── e2e da proteção de rotas
```

## 9. Variáveis de ambiente

Novas variáveis (as da spec 01 continuam iguais):

| Variável     | Descrição                                          | Valor em desenvolvimento                  |
| ------------ | -------------------------------------------------- | ----------------------------------------- |
| `JWT_SECRET` | Secret para validar a assinatura dos tokens        | **O mesmo valor** do `.env` do users-service |

## 10. Fora do escopo

- Endpoints de login, registro, refresh ou validação de token (ficam no users-service).
- Emissão de tokens pelo products-service.
- **RoleGuard** ou qualquer decorator de roles. A verificação de role (por exemplo, só `seller` cria produto) será feita direto nos controllers/services, nas specs dos endpoints de produto.
- Conferir no users-service se o usuário do token ainda existe ou está ativo.
- Refresh token, revogação ou blacklist de tokens.
- Endpoints de produtos.
- Swagger e health check.

## 11. Critérios de aceite

### Dependências e configuração

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-01 | O `package.json` contém `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` nas mesmas versões do users-service, e `pnpm install` termina sem erros. | Comparar os dois `package.json` e rodar a instalação.                          |
| CA-02 | `.env.example` contém a chave `JWT_SECRET` sem valor, e o `.env` local tem o mesmo valor do users-service.                               | Ler os arquivos.                                                               |
| CA-03 | Sem `JWT_SECRET` no ambiente, a aplicação não sobe e mostra um erro sobre a variável ausente.                                            | Remover a variável do `.env` e rodar `pnpm run start:dev`.                     |
| CA-04 | Nenhum valor de secret aparece no código-fonte.                                                                                           | Buscar o valor do secret em `src/` e `test/` (só pode aparecer secret fictício de teste). |

### Proteção global

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-05 | `GET /` sem token retorna 401.                                                                                                            | Requisição sem header `Authorization`.                                         |
| CA-06 | O guard está registrado globalmente via `APP_GUARD`, e nenhum controller declara o guard individualmente.                                | Revisão do `AuthModule` e dos controllers.                                     |
| CA-07 | Uma rota nova criada sem `@Public()` fica protegida automaticamente.                                                                     | Teste e2e com um controller de teste sem guard declarado.                      |
| CA-08 | Não existe nenhuma rota de autenticação no products-service: `POST /auth/login` e `POST /auth/register` retornam 404.                     | Requisições às rotas e leitura dos logs de inicialização.                      |

### Validação do token

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-09 | Header sem o prefixo `Bearer` → 401.                                                                                                      | Teste e2e.                                                                     |
| CA-10 | `Bearer` sem token → 401.                                                                                                                 | Teste e2e.                                                                     |
| CA-11 | Token malformado → 401.                                                                                                                   | Teste e2e.                                                                     |
| CA-12 | Token assinado com outro secret → 401.                                                                                                    | Teste e2e gerando o token com um secret diferente.                             |
| CA-13 | Token com payload alterado depois da assinatura → 401.                                                                                    | Teste e2e alterando o trecho do payload de um token válido.                    |
| CA-14 | Token expirado → 401.                                                                                                                     | Teste e2e gerando um token já expirado.                                        |
| CA-15 | Todas as respostas 401 têm só `statusCode` e `message`, sem stack trace nem motivo técnico da biblioteca.                                 | Conferir o corpo das respostas nos testes e2e.                                 |
| CA-16 | Token válido de `seller` e token válido de `buyer` dão acesso a rotas protegidas.                                                         | Teste e2e com os dois roles.                                                   |

### Interoperabilidade com o users-service

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-17 | Um token obtido no login real do users-service (`POST http://localhost:3000/auth/login`) é aceito por uma rota protegida do products-service. | Teste manual com os dois serviços no ar: login no users-service e `GET http://localhost:3001/` com o token → 200. |
| CA-18 | Se o `JWT_SECRET` do products-service for diferente do users-service, o mesmo token passa a ser rejeitado com 401.                       | Teste manual trocando o secret do products-service e reiniciando.             |

### Dados do usuário autenticado

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-19 | Com token válido, `req.user` contém exatamente `id`, `email` e `role`, com `id` igual ao `sub` do token.                                  | Teste e2e com um controller de teste que devolve `req.user`.                   |
| CA-20 | `req.user` não contém `sub`, `iat`, `exp` nem campos extras que estejam no payload.                                                       | Mesmo teste, com um payload contendo um campo extra.                           |

### Decorator `@Public()`

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-21 | `@Public()` em um método deixa só aquela rota pública; as outras rotas do mesmo controller continuam exigindo token.                      | Teste e2e com controller de teste misto.                                       |
| CA-22 | `@Public()` em um controller deixa todas as rotas da classe públicas.                                                                     | Teste e2e com controller de teste público.                                     |
| CA-23 | Uma rota pública responde normalmente mesmo recebendo um token inválido ou expirado.                                                      | Teste e2e.                                                                     |
| CA-24 | A chave `isPublic` é definida em um único lugar e reutilizada pelo decorator e pelo guard.                                                | Revisão de código.                                                             |

### Qualidade

| #     | Critério                                                                                                                                  | Como verificar                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CA-25 | Existem testes unitários do guard (rota pública × protegida, prioridade método × controller) e da strategy (mapeamento para `id`, `email`, `role`). | `pnpm run test`.                                                               |
| CA-26 | Existem testes e2e cobrindo todos os cenários da seção 6.                                                                                 | `pnpm run test:e2e`.                                                           |
| CA-27 | `pnpm run build`, `pnpm run lint`, `pnpm run test` e `pnpm run test:e2e` terminam sem erros.                                              | Rodar os comandos.                                                             |

## 12. Pontos de atenção

- **Secret compartilhado:** se os valores de `JWT_SECRET` dos dois serviços divergirem, **todas** as requisições autenticadas ao products-service vão retornar 401, sem outro sinal de erro. É a primeira coisa a conferir se um token válido for rejeitado.
- **Enum de roles duplicado:** o enum de roles existe nos dois serviços. Se um role novo for criado no users-service, o products-service precisa ser atualizado também.
- **Dados do token podem estar desatualizados:** como a validação é stateless, um usuário desativado ou com role alterado no users-service continua com acesso no products-service até o token expirar (24h). Isso é aceito nesta spec.
- **Expiração é definida no users-service:** o products-service só confere o `exp` do token. Mudar a duração do token é uma alteração no users-service.
- **Porta do banco:** o pedido original citava a porta 5434 para o banco do products-service, mas a spec 01 já definiu **5436** (a 5434 é do payments-db). Esta spec não altera isso.
- **api-gateway:** quando as requisições passarem pelo api-gateway, ele precisa repassar o header `Authorization` para o products-service; senão toda requisição vai chegar sem token e receber 401.
- **E2e e banco:** o e2e que sobe o `AppModule` inteiro precisa do PostgreSQL no ar. Os testes da proteção de rotas podem montar só o necessário (guard, strategy e controllers de teste), como no users-service, para não depender do banco.

## 13. Commits

Faça sempre um commit após cada implementação desta spec.

- Cada etapa (dependências e variável de ambiente, tipos e enum, decorator, strategy, guard, AuthModule e registro global, ajuste do e2e existente, testes unitários, testes e2e) deve gerar um **commit separado**.
- Antes de cada commit, rodar o lint do products-service e garantir que passa sem erros.
- Mensagens no mesmo padrão do histórico do projeto (ex.: `feat(auth): ...`, `test(auth): ...`, `docs(specs): ...`), em português e descrevendo a etapa de forma objetiva.
