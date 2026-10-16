# SPEC: Login com JWT no users-service

| Campo        | Valor                                          |
| ------------ | ---------------------------------------------- |
| Serviço      | users-service                                  |
| Sistema      | marketplace-ms                                 |
| Tipo         | Funcionalidade / endpoint HTTP                 |
| Depende de   | `01-scaffold.md`, `02-register-user.md`        |
| Status       | Pronta para planejamento                       |
| Data         | 2026-10-10                                     |

---

## 1. Objetivo

Permitir que usuários já cadastrados se autentiquem no marketplace. Ao final desta spec, o users-service deve expor o endpoint **`POST /auth/login`**, que recebe e-mail e senha, confere as credenciais, verifica se a conta está ativa e devolve os dados do usuário (**sem a senha**) junto com um **token JWT** válido por **24 horas**.

Esta spec cobre **somente a emissão** do token. Validar o token e proteger rotas fica para a próxima spec.

## 2. Ponto de partida

Já existe (entregue pelas specs `01-scaffold.md` e `02-register-user.md`):

- Projeto NestJS 11 com pnpm, TypeORM e PostgreSQL via Docker Compose.
- `ConfigModule` global, que carrega as variáveis do `.env`.
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`.
- Entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`) e os enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`).
- `UsersService` com a operação de buscar usuário por e-mail.
- `AuthModule` com controller (prefixo `/auth`), service e o endpoint `POST /auth/register` funcionando.
- Dependência `bcryptjs` instalada; senhas gravadas como hash bcrypt (10 rounds).
- Um tipo de "usuário público" (usuário sem `password`) já usado na resposta do cadastro.

## 3. Requisitos funcionais

### RF-01: Dependências de JWT
- O projeto deve declarar as dependências **`@nestjs/jwt`**, **`@nestjs/passport`**, **`passport`** e **`passport-jwt`** (e a tipagem de `passport-jwt` como dependência de desenvolvimento, se necessária).
- Nesta spec, apenas `@nestjs/jwt` é usado de fato (para assinar o token). As dependências de Passport ficam instaladas para a próxima spec; **nenhuma** estratégia, guard ou decorator de autenticação deve ser criado agora.
- `bcryptjs` já existe e deve ser reaproveitado; nenhuma outra biblioteca de hash deve ser adicionada.

### RF-02: Configuração do segredo do JWT
- O segredo usado para assinar os tokens vem **exclusivamente** da variável de ambiente **`JWT_SECRET`**.
- O segredo **não** pode estar escrito no código-fonte, nem ter valor padrão de fallback.
- `JWT_SECRET` deve ser adicionada ao `.env.example` (sem valor) e ao `.env` local (com um valor de desenvolvimento).
- Se `JWT_SECRET` não estiver definida ou estiver vazia, a aplicação deve **falhar ao iniciar** com uma mensagem clara indicando a variável ausente. Nunca deve subir e assinar tokens com segredo vazio ou indefinido.
- A configuração do JWT deve ser registrada dentro do `AuthModule`, lendo o valor pelo mecanismo de configuração já existente (não ler o `.env` diretamente).

### RF-03: Expiração do token
- Todo token emitido expira em **24 horas** a partir da emissão.
- O token deve carregar as claims padrão de emissão (`iat`) e expiração (`exp`), com `exp - iat = 86400` segundos.
- O algoritmo de assinatura é o padrão do `@nestjs/jwt` (HS256).

### RF-04: Endpoint de login
- Método e rota: **`POST /auth/login`**, no mesmo controller do `AuthModule`.
- Corpo da requisição: JSON conforme o DTO da seção 4.1.
- Em caso de sucesso, responde **200 OK** (e não 201, que é o padrão do NestJS para POST). Login não cria recurso.
- O endpoint é público: não exige token nem nenhum cabeçalho de autenticação.

### RF-05: Validação dos dados de entrada
- Os campos do DTO (seção 4.1) devem ser validados **antes** de qualquer acesso ao banco.
- Dados inválidos são rejeitados com **400 Bad Request** pelo `ValidationPipe` global, listando todos os erros encontrados, em português, no mesmo padrão do cadastro.
- Propriedades não previstas no DTO são rejeitadas com 400.

### RF-06: Busca do usuário
- O serviço busca o usuário pelo e-mail informado, reaproveitando a operação já existente no `UsersService`.
- O e-mail é comparado **exatamente como foi enviado**, igual ao cadastro (sem normalização de maiúsculas/minúsculas; ver seção 8).
- Se nenhum usuário for encontrado → **401** com a mensagem **`Credenciais inválidas`**.

### RF-07: Conferência da senha
- A senha enviada é comparada com o hash armazenado usando **bcrypt** (`bcryptjs`).
- A senha **nunca** é comparada em texto puro, e o hash nunca é recalculado para comparação de strings.
- Se a senha não conferir → **401** com a mensagem **`Credenciais inválidas`**.

### RF-08: Mensagem genérica para credenciais erradas
- E-mail inexistente e senha errada devem produzir respostas **idênticas**: mesmo status (401), mesma `message` (`Credenciais inválidas`) e mesmo `error` (`Unauthorized`).
- Nenhuma resposta, cabeçalho ou log acessível ao cliente pode indicar qual dos dois campos está errado.
- **Recomendado:** o tempo de resposta para e-mail inexistente não deve ser perceptivelmente menor que o de senha errada (evitar que o cliente descubra e-mails cadastrados medindo o tempo de resposta).

### RF-09: Verificação de conta ativa
- A verificação de status acontece **somente depois** que e-mail e senha foram confirmados. Ou seja, a mensagem de conta inativa só aparece para quem tem as credenciais corretas, e não revela a existência da conta para terceiros.
- Se o usuário tiver `status` diferente de `active` → **401** com a mensagem **`Conta inativa`**.
- Nenhum token é gerado para conta inativa.

### RF-10: Geração do token
- Com credenciais válidas e conta ativa, o serviço gera um token JWT assinado com `JWT_SECRET`, com o payload da seção 4.3 e expiração de 24h (RF-03).
- A geração do token fica no service de autenticação, não no controller.

### RF-11: Resposta de sucesso
- A resposta contém dois campos: `user` (dados do usuário **sem** `password`) e `token` (string JWT). Formato na seção 4.2.
- O objeto `user` segue exatamente o mesmo formato da resposta do cadastro (`POST /auth/register`).

### RF-12: Proteção da senha
- Nenhuma resposta deste endpoint (sucesso ou erro) pode conter o campo `password`, nem em texto puro nem como hash.
- O payload do token não pode conter a senha nem o hash.
- A senha enviada nunca é escrita em log nem repetida em mensagens de erro.

## 4. Estrutura de dados

### 4.1 DTO de entrada: `LoginDto`

| Campo      | Tipo   | Obrigatório | Regras                         | Mensagem de erro esperada (exemplo)                                    |
| ---------- | ------ | ----------- | ------------------------------ | ---------------------------------------------------------------------- |
| `email`    | string | sim         | Deve ser um e-mail válido.     | `email é obrigatório` / `email deve ser um e-mail válido`              |
| `password` | string | sim         | Mínimo de **6** caracteres.    | `password é obrigatório` / `password deve ter no mínimo 6 caracteres`  |

Regras gerais:
- Os dois campos devem ser string; outro tipo (número, objeto, `null`) é erro de validação.
- Nenhum outro campo é aceito.
- As mensagens seguem o mesmo padrão do `RegisterDto`.

Exemplo de corpo válido:

```json
{
  "email": "maria@example.com",
  "password": "senha123"
}
```

### 4.2 Resposta de sucesso (200)

| Campo   | Tipo   | Observação                                                       |
| ------- | ------ | ---------------------------------------------------------------- |
| `user`  | objeto | Mesmos 8 campos da resposta do cadastro, **sem** `password`.     |
| `token` | string | JWT assinado com `JWT_SECRET`, válido por 24h.                   |

Campos de `user`: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`.

Exemplo:

```json
{
  "user": {
    "id": "3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90",
    "email": "maria@example.com",
    "firstName": "Maria",
    "lastName": "Silva",
    "role": "buyer",
    "status": "active",
    "createdAt": "2026-10-10T14:00:00.000Z",
    "updatedAt": "2026-10-10T14:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
}
```

### 4.3 Payload do JWT

| Claim   | Tipo              | Origem / observação                                  |
| ------- | ----------------- | ---------------------------------------------------- |
| `sub`   | UUID (string)     | `id` do usuário.                                     |
| `email` | string            | `email` do usuário.                                  |
| `role`  | `seller`\|`buyer` | `role` do usuário.                                   |
| `iat`   | número (segundos) | Adicionado automaticamente na assinatura.            |
| `exp`   | número (segundos) | Adicionado automaticamente; `iat + 86400`.           |

Regras:
- Nenhuma outra claim de dados do usuário entra no payload (sem `password`, `status`, `firstName`, `lastName`, datas).
- O formato do payload (`sub`, `email`, `role`) deve ser definido como um tipo próprio dentro do `AuthModule`, para ser reaproveitado na próxima spec (validação do token).

Exemplo do payload decodificado:

```json
{
  "sub": "3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90",
  "email": "maria@example.com",
  "role": "buyer",
  "iat": 1791640800,
  "exp": 1791727200
}
```

### 4.4 Respostas de erro

As respostas de erro seguem o formato padrão de exceções HTTP do NestJS: `statusCode`, `message` e `error`.

| Status | Quando                                                  | `message`                                       | `error`         |
| ------ | ------------------------------------------------------- | ----------------------------------------------- | --------------- |
| 400    | Campo inválido, ausente ou não previsto.                | **Lista** com uma mensagem por erro encontrado. | `Bad Request`   |
| 401    | E-mail não cadastrado **ou** senha incorreta.           | `Credenciais inválidas`                         | `Unauthorized`  |
| 401    | Credenciais corretas, mas `status` diferente de `active`. | `Conta inativa`                                 | `Unauthorized`  |

Exemplo de 401 (credenciais):

```json
{
  "statusCode": 401,
  "message": "Credenciais inválidas",
  "error": "Unauthorized"
}
```

Exemplo de 401 (conta inativa):

```json
{
  "statusCode": 401,
  "message": "Conta inativa",
  "error": "Unauthorized"
}
```

### 4.5 Variáveis de ambiente

| Variável     | Obrigatória | Descrição                                   |
| ------------ | ----------- | ------------------------------------------- |
| `JWT_SECRET` | sim         | Segredo usado para assinar os tokens JWT.   |

### 4.6 Estrutura de pastas esperada (alto nível)

```
src/
├── auth/
│   ├── dto/
│   │   ├── register.dto    → já existe
│   │   └── login.dto       → novo
│   ├── (tipo do payload JWT) → novo
│   ├── auth.controller     → ganha a rota POST /auth/login
│   ├── auth.service        → ganha a operação de login
│   ├── auth.service.spec   → ganha os testes de login
│   └── auth.module         → passa a registrar o módulo de JWT
└── users/                  → sem mudanças (reaproveita a busca por e-mail)
```

## 5. Fluxo do login

1. O cliente envia `POST /auth/login` com o corpo da seção 4.1.
2. A validação roda. Se falhar → **400** com a lista de erros. Fim.
3. O serviço busca o usuário pelo e-mail. Se não encontrar → **401 `Credenciais inválidas`**. Fim.
4. O serviço compara a senha enviada com o hash usando bcrypt. Se não conferir → **401 `Credenciais inválidas`**. Fim.
5. O serviço verifica o status. Se não for `active` → **401 `Conta inativa`**. Fim.
6. O serviço monta o payload (`sub`, `email`, `role`) e assina o token com `JWT_SECRET` e expiração de 24h.
7. O serviço responde **200** com `{ user, token }`, sem `password`.

## 6. Fora do escopo

Fica para specs futuras:
- Estratégia JWT do Passport, guards, decorators de usuário atual e proteção de rotas.
- Validação de token (ex.: `GET /session/validate/:token`) e endpoints que dependam de usuário autenticado.
- Refresh token, sessões persistidas, logout, revogação ou blacklist de tokens.
- Limite de tentativas de login, bloqueio de conta, captcha.
- Normalização de e-mail (maiúsculas/minúsculas).
- Endpoints para ativar/desativar conta.
- Autorização por role.
- Publicação de eventos (RabbitMQ) sobre login.
- Ajustes no api-gateway.

## 7. Critérios de aceite

| #     | Critério                                                                                                                                          | Como verificar                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CA-01 | O `package.json` declara `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt`; `bcryptjs` continua sendo a única lib de hash.             | Ler o `package.json`.                                                       |
| CA-02 | Não existe nenhuma estratégia Passport, guard ou decorator de autenticação no código.                                                              | Busca no `src/`.                                                            |
| CA-03 | `.env.example` contém `JWT_SECRET` sem valor; o código-fonte não contém nenhum segredo nem valor padrão para ele.                                   | Ler o `.env.example` e buscar no `src/`.                                    |
| CA-04 | Sem `JWT_SECRET` definida, a aplicação não sobe e a mensagem de erro cita a variável.                                                              | Remover a variável do `.env` e iniciar a aplicação.                         |
| CA-05 | A rota `POST /auth/login` aparece no mapeamento de rotas nos logs de inicialização.                                                                | Iniciar a aplicação.                                                        |
| CA-06 | Login com e-mail e senha corretos de um usuário ativo retorna **200** (não 201) com `user` e `token`.                                               | Cadastrar via `/auth/register` e fazer login.                               |
| CA-07 | O objeto `user` da resposta tem os 8 campos da seção 4.2 e **não** contém `password`.                                                               | Conferir o JSON da resposta.                                                |
| CA-08 | O token decodificado contém `sub` igual ao `id` do usuário, `email` e `role` corretos, e nenhuma outra claim de dados além de `iat` e `exp`.         | Decodificar o token (ex.: jwt.io ou teste unitário).                        |
| CA-09 | `exp - iat` do token é exatamente **86400**.                                                                                                       | Decodificar o token.                                                        |
| CA-10 | O token é válido quando verificado com o `JWT_SECRET` configurado e inválido com qualquer outro segredo.                                           | Teste unitário ou verificação manual.                                       |
| CA-11 | Login com e-mail não cadastrado retorna **401** com `message = "Credenciais inválidas"`.                                                            | Requisição HTTP.                                                            |
| CA-12 | Login com e-mail existente e senha errada retorna **401** com `message = "Credenciais inválidas"`.                                                  | Requisição HTTP.                                                            |
| CA-13 | Os corpos das respostas de CA-11 e CA-12 são **idênticos**.                                                                                        | Comparar os dois JSONs.                                                     |
| CA-14 | Usuário com `status = inactive` e senha correta recebe **401** com `message = "Conta inativa"` e nenhum token.                                      | Alterar o status no banco e fazer login.                                    |
| CA-15 | Usuário com `status = inactive` e senha **errada** recebe **401** com `Credenciais inválidas` (não `Conta inativa`).                               | Alterar o status no banco e fazer login com senha errada.                   |
| CA-16 | Corpo vazio retorna **400** com mensagens para `email` e `password`.                                                                                | Requisição com `{}`.                                                        |
| CA-17 | `email` inválido (ex.: `maria@`) retorna **400**; `password` com 5 caracteres retorna **400**.                                                      | Requisições HTTP.                                                           |
| CA-18 | Campos extras (ex.: `role`) retornam **400**.                                                                                                      | Requisição HTTP.                                                            |
| CA-19 | Nenhuma resposta (200, 400 ou 401) contém a senha enviada ou o hash.                                                                               | Conferir os corpos das respostas.                                           |
| CA-20 | O endpoint `POST /auth/register` continua funcionando como antes.                                                                                  | Rodar os testes existentes + requisição de cadastro.                        |
| CA-21 | Existem testes unitários do service de autenticação cobrindo: login com sucesso (com conferência do payload), e-mail inexistente, senha errada, conta inativa e ausência de `password` no retorno. | `pnpm run test` passa.                                                      |
| CA-22 | `pnpm run build` e `pnpm run lint` terminam sem erros.                                                                                             | Rodar os comandos.                                                          |

## 8. Pontos de atenção

- **Maiúsculas e minúsculas no e-mail:** como o cadastro não normaliza o e-mail, o login também não normaliza. `Maria@Example.com` não consegue logar numa conta cadastrada como `maria@example.com`. Corrigir isso exige mudar cadastro e login juntos, numa spec própria.
- **Tempo de resposta (RF-08):** quando o e-mail não existe, o fluxo termina antes da comparação bcrypt e responde mais rápido. Isso permite descobrir e-mails cadastrados medindo o tempo. É recomendado igualar o custo dos dois casos; se o plano decidir não fazer isso agora, deve registrar a decisão.
- **Segredo em produção:** o valor de `JWT_SECRET` do `.env` local é só para desenvolvimento. O `.env` não deve ser commitado (já está no `.gitignore`; confirmar antes do commit).
- **Compartilhamento do segredo:** outros serviços (ex.: api-gateway) que forem validar o token vão precisar do mesmo `JWT_SECRET`. Isso fica para as specs de validação de token e do gateway.
- **Tipo do payload:** o tipo do payload criado aqui (seção 4.3) deve ser o mesmo usado pela estratégia JWT da próxima spec. Evitar duplicá-lo depois.

## 9. Commits

A implementação desta spec deve ser feita com **commits granulares**: **um commit para cada item inserido no projeto**, assim que esse item estiver pronto e o projeto compilar. Não acumular várias mudanças em um único commit, e não deixar tudo para um commit no final.

Regras:
- Cada commit contém **uma única mudança lógica** (uma dependência, um arquivo de configuração, um DTO, uma operação de service, uma rota, um conjunto de testes).
- Antes de cada commit, `pnpm run build` deve passar. Antes dos commits que mexem em lógica ou testes, `pnpm run test` também deve passar.
- Mensagens no padrão **Conventional Commits** (`feat`, `chore`, `test`, `docs`, `refactor`), em português, descrevendo o que entrou.
- Nunca commitar o `.env` nem segredos reais.

Sequência sugerida (o plano pode ajustar a ordem, mantendo a granularidade):

| #  | Item inserido                                                          | Exemplo de mensagem                                                        |
| -- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1  | Dependências `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` (+ tipagens) | `chore(deps): adiciona dependências de JWT e Passport`                      |
| 2  | `JWT_SECRET` no `.env.example`                                         | `chore(config): adiciona JWT_SECRET ao .env.example`                        |
| 3  | Registro do módulo JWT no `AuthModule`, lendo `JWT_SECRET`, expiração de 24h e falha ao iniciar sem o segredo | `feat(auth): configura módulo JWT com segredo via ambiente e expiração de 24h` |
| 4  | Tipo do payload JWT (`sub`, `email`, `role`)                           | `feat(auth): define tipo do payload do token JWT`                           |
| 5  | `LoginDto` com validações e mensagens                                  | `feat(auth): cria LoginDto com validação de email e senha`                  |
| 6  | Operação de login no service (busca, bcrypt, status, token)            | `feat(auth): implementa login com verificação de credenciais e emissão de JWT` |
| 7  | Rota `POST /auth/login` no controller, respondendo 200                 | `feat(auth): expõe endpoint POST /auth/login`                               |
| 8  | Testes unitários do login no `auth.service.spec`                       | `test(auth): cobre cenários de login no AuthService`                        |
| 9  | (Se houver) ajustes de lint/formatação ou documentação                 | `chore: ajusta lint` / `docs: ...`                                          |
