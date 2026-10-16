# SPEC — Consulta de Usuários (profile, sellers e busca por ID)

**Serviço:** users-service
**Projeto:** marketplace-ms
**Status:** Proposta
**Data:** 2026-10-10

---

## 1. Contexto

O users-service já possui:

- NestJS + PostgreSQL com a entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`)
- `POST /auth/register` e `POST /auth/login` funcionando, com geração de JWT
- `JwtAuthGuard` registrado globalmente e decorator `@Public()` (spec 04)
- Usuário autenticado disponível em `req.user` com `id`, `email` e `role`
- `UsersModule` com um `UsersService` que hoje expõe apenas os métodos usados pelo fluxo de autenticação (busca por e-mail e criação). Não existe `UsersController`.

O marketplace precisa consultar usuários em três situações: o frontend exibir o perfil do usuário logado, o frontend e o products-service listarem os vendedores disponíveis, e qualquer consumidor obter os dados de um usuário específico a partir do seu ID.

## 2. Objetivo

Disponibilizar **apenas os três endpoints de leitura essenciais** para o funcionamento do marketplace, todos protegidos por JWT e sem nunca expor a senha do usuário.

## 3. Escopo

### Dentro do escopo

- `GET /users/profile` — dados do usuário autenticado
- `GET /users/sellers` — lista de vendedores ativos
- `GET /users/:id` — dados de um usuário pelo ID
- Novos métodos de consulta no `UsersService` existente
- Criação do `UsersController` e seu registro no `UsersModule`

### Fora do escopo

- Atualização de usuário (update)
- Remoção de usuário (delete)
- Listagem geral de usuários, paginação, filtros ou ordenação configurável
- Troca de senha (change password)
- Autorização por perfil (RoleGuard) — qualquer usuário autenticado pode acessar os três endpoints
- Alterações em `POST /auth/register`, `POST /auth/login`, no guard ou na estratégia JWT

---

## 4. Requisitos Funcionais

### RF-01 — Representação pública do usuário

1. **RF-01.1** — Todos os endpoints desta spec devem retornar o usuário em sua **representação pública**, contendo exatamente: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt` e `updatedAt`.
2. **RF-01.2** — O campo `password` (nem seu hash, nem qualquer derivado) **nunca** pode aparecer em nenhuma resposta, em nenhum cenário.
3. **RF-01.3** — A representação pública deve ser a mesma já retornada por `POST /auth/register` e `POST /auth/login` (mesmos campos, mesmos nomes). A regra de remoção da senha deve existir em um único ponto do serviço e ser reutilizada, sem duplicação entre autenticação e consulta de usuários.

### RF-02 — GET /users/profile

1. **RF-02.1** — Deve retornar os dados do usuário autenticado que fez a requisição.
2. **RF-02.2** — O usuário deve ser buscado **no banco de dados** a partir do `id` presente em `req.user`, garantindo dados atualizados (não deve retornar apenas o conteúdo do token).
3. **RF-02.3** — Não recebe parâmetros de rota, query ou corpo; o usuário consultado é sempre o dono do token.
4. **RF-02.4** — Em caso de sucesso, responde **200 OK** com a representação pública do usuário (RF-01).
5. **RF-02.5** — Se o `id` do token não corresponder a nenhum usuário existente no banco (ex.: usuário removido após a emissão do token), deve responder **401 Unauthorized**, pois o token não representa mais um usuário válido. Não deve responder 500 nem retornar corpo vazio.

### RF-03 — GET /users/sellers

1. **RF-03.1** — Deve retornar a lista de todos os usuários que atendem **simultaneamente** às duas condições:
   - `role` igual a `seller`
   - `status` igual a `active`
2. **RF-03.2** — Usuários com `role` `buyer`, ou com `status` `inactive`, nunca devem aparecer na lista.
3. **RF-03.3** — Cada item da lista deve estar na representação pública (RF-01).
4. **RF-03.4** — Em caso de sucesso, responde **200 OK** com um array (JSON) de usuários.
5. **RF-03.5** — Se não houver nenhum vendedor ativo, responde **200 OK** com um array vazio (nunca 404).
6. **RF-03.6** — A lista não é paginada e não aceita filtros; a ordem dos itens não é um requisito desta spec.
7. **RF-03.7** — O endpoint é consumido tanto pelo frontend quanto pelo products-service; ambos usam o mesmo contrato e o mesmo mecanismo de autenticação (JWT no header `Authorization`).

### RF-04 — GET /users/:id

1. **RF-04.1** — Deve retornar os dados do usuário cujo identificador (UUID) corresponde ao parâmetro `:id`.
2. **RF-04.2** — Deve retornar o usuário independentemente do seu `role` ou `status` (inclui buyers, sellers e usuários inativos).
3. **RF-04.3** — Em caso de sucesso, responde **200 OK** com a representação pública do usuário (RF-01).
4. **RF-04.4** — Se não existir usuário com o ID informado, responde **404 Not Found**, com mensagem indicando que o usuário não foi encontrado.
5. **RF-04.5** — Se o `:id` informado não estiver no formato UUID, o serviço deve responder **404 Not Found** (um ID inválido nunca corresponde a um usuário existente). Em nenhum caso um ID mal formatado pode causar erro 500 ou expor erro do banco de dados.

### RF-05 — Ordem de declaração das rotas

1. **RF-05.1** — As rotas estáticas `GET /users/profile` e `GET /users/sellers` devem ser declaradas **antes** da rota dinâmica `GET /users/:id`.
2. **RF-05.2** — Uma requisição a `/users/profile` ou `/users/sellers` **nunca** pode ser tratada pela rota `/users/:id` (ou seja, `profile` e `sellers` jamais devem ser interpretados como um ID).

### RF-06 — Estrutura no UsersModule

1. **RF-06.1** — O `UsersService` existente deve ser estendido com os métodos de consulta necessários: buscar usuário por ID e listar vendedores ativos. Os métodos atuais (busca por e-mail e criação) não devem ter seu comportamento alterado.
2. **RF-06.2** — Deve ser criado um `UsersController` responsável pelas rotas sob o prefixo `/users`, contendo apenas os três endpoints desta spec.
3. **RF-06.3** — O `UsersController` deve ser registrado no `UsersModule`.
4. **RF-06.4** — Nenhum endpoint desta spec deve ser marcado com `@Public()`; a proteção vem automaticamente do `JwtAuthGuard` global.

---

## 5. Respostas Esperadas

| Endpoint              | Cenário                                              | Status           | Corpo                                   |
|-----------------------|------------------------------------------------------|------------------|-----------------------------------------|
| `GET /users/profile`  | Token válido, usuário existe                         | 200 OK           | Usuário logado (representação pública)  |
| `GET /users/profile`  | Token válido, usuário não existe mais no banco       | 401 Unauthorized | Erro padrão do NestJS                   |
| `GET /users/sellers`  | Token válido, existem vendedores ativos              | 200 OK           | Array de vendedores ativos              |
| `GET /users/sellers`  | Token válido, nenhum vendedor ativo                  | 200 OK           | Array vazio                             |
| `GET /users/:id`      | Token válido, usuário existe                         | 200 OK           | Usuário (representação pública)         |
| `GET /users/:id`      | Token válido, UUID sem usuário correspondente        | 404 Not Found    | Erro padrão do NestJS                   |
| `GET /users/:id`      | Token válido, `:id` fora do formato UUID             | 404 Not Found    | Erro padrão do NestJS                   |
| Qualquer um dos três  | Token ausente, inválido, malformado ou expirado      | 401 Unauthorized | Erro padrão do NestJS (tratado pelo guard) |

**Requisitos das respostas de erro:**

- Devem seguir o formato padrão de erro do NestJS (`statusCode`, `message`, `error`).
- Não devem expor stack trace, detalhes de query ou mensagens internas do banco de dados.

---

## 6. Requisitos Não Funcionais

- **RNF-01** — As consultas não devem carregar mais dados do que o necessário para montar a resposta; em particular, a listagem de sellers deve ser filtrada no banco de dados (não em memória após carregar todos os usuários).
- **RNF-02** — Os novos artefatos (controller e métodos de serviço) devem ficar dentro do módulo `users`, seguindo a estrutura de pastas já existente.
- **RNF-03** — Os contratos de `POST /auth/register` e `POST /auth/login` não podem ser alterados.
- **RNF-04** — Os endpoints são somente leitura: nenhuma requisição desta spec pode alterar dados no banco.

---

## 7. Critérios de Aceite

### GET /users/profile

- [ ] **CA-01** — Com um token válido obtido em `POST /auth/login`, retorna 200 com `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt` e `updatedAt` do usuário que fez login.
- [ ] **CA-02** — A resposta não contém o campo `password`.
- [ ] **CA-03** — Os dados vêm do banco: se um campo do usuário (ex.: `firstName`) for alterado diretamente no banco após o login, a próxima chamada com o mesmo token retorna o valor atualizado.
- [ ] **CA-04** — Com um token válido cujo `id` não existe mais no banco, retorna 401.
- [ ] **CA-05** — Sem token, retorna 401.

### GET /users/sellers

- [ ] **CA-06** — Com uma base contendo sellers ativos, sellers inativos, buyers ativos e buyers inativos, retorna 200 com **somente** os sellers ativos.
- [ ] **CA-07** — Todos os itens retornados têm `role` = `seller` e `status` = `active`.
- [ ] **CA-08** — Nenhum item da lista contém o campo `password`.
- [ ] **CA-09** — Sem nenhum seller ativo na base, retorna 200 com array vazio.
- [ ] **CA-10** — Acessível por qualquer usuário autenticado, seja buyer ou seller.
- [ ] **CA-11** — Sem token, retorna 401.

### GET /users/:id

- [ ] **CA-12** — Com o UUID de um usuário existente, retorna 200 com a representação pública desse usuário.
- [ ] **CA-13** — A resposta não contém o campo `password`.
- [ ] **CA-14** — Retorna o usuário mesmo que ele seja buyer ou esteja com `status` `inactive`.
- [ ] **CA-15** — Com um UUID válido que não corresponde a nenhum usuário, retorna 404.
- [ ] **CA-16** — Com um `:id` que não é UUID (ex.: `abc`, `123`), retorna 404 e nunca 500.
- [ ] **CA-17** — Sem token, retorna 401.

### Ordem das rotas

- [ ] **CA-18** — `GET /users/profile` retorna o perfil do usuário logado (e não 404 por tentar buscar um usuário com ID `profile`).
- [ ] **CA-19** — `GET /users/sellers` retorna a lista de sellers (e não 404 por tentar buscar um usuário com ID `sellers`).

### Estrutura

- [ ] **CA-20** — Existe um `UsersController` registrado no `UsersModule`, com apenas os três endpoints desta spec.
- [ ] **CA-21** — Nenhum dos três endpoints usa `@Public()`.
- [ ] **CA-22** — Não existem endpoints de update, delete, listagem paginada ou troca de senha.
- [ ] **CA-23** — `POST /auth/register` e `POST /auth/login` continuam funcionando sem alteração de contrato.

### Qualidade

- [ ] **CA-24** — Existem testes unitários do `UsersService` cobrindo: busca por ID (encontrado e não encontrado) e listagem de sellers ativos (filtro aplicado por role e status).
- [ ] **CA-25** — Existem testes unitários do `UsersController` cobrindo os três endpoints, incluindo a ausência de `password` nas respostas e o 404 de `GET /users/:id`.
- [ ] **CA-26** — Existem testes e2e cobrindo os cenários da seção 5.
- [ ] **CA-27** — Lint, build e testes passam sem erros.

---

## 8. Processo de Implementação

- Cada etapa da implementação (métodos de consulta no service, controller e registro no módulo, testes unitários, testes e2e) deve resultar em um **commit separado**.
- **Antes de cada commit**, o lint do users-service deve ser executado e passar sem erros.
- Mensagens de commit devem descrever de forma objetiva a etapa implementada, seguindo o padrão já usado no repositório (ex.: `feat(users): ...`, `test(users): ...`).

---

## 9. Fora de Escopo (reforço)

- Não implementar update de usuário.
- Não implementar delete de usuário.
- Não implementar listagem geral com paginação ou filtros.
- Não implementar troca de senha.
- Não implementar autorização por role nos endpoints de consulta.
