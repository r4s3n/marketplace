# SPEC: Registro de usuário no users-service

| Campo        | Valor                                   |
| ------------ | --------------------------------------- |
| Serviço      | users-service                           |
| Sistema      | marketplace-ms                          |
| Tipo         | Funcionalidade / endpoint HTTP          |
| Depende de   | `01-scaffold.md`                        |
| Status       | Pronta para planejamento                |
| Data         | 2026-10-10                              |

---

## 1. Objetivo

Permitir que novos usuários se cadastrem no marketplace. Ao final desta spec, o users-service deve expor o endpoint **`POST /auth/register`**, que valida os dados recebidos, garante que o e-mail não está em uso, guarda a senha como hash e devolve os dados do usuário criado **sem a senha**.

Esta é a primeira rota HTTP do serviço.

## 2. Ponto de partida

Já existe (entregue pela spec `01-scaffold.md`):

- Projeto NestJS 11 com pnpm, TypeORM e PostgreSQL via Docker Compose (porta 5433, database `users_db`).
- Módulo `users` com a entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`) e os enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`).
- Restrição de unicidade no `email` e enums do PostgreSQL para `role` e `status`.
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`.
- `UsersService` vazio, sem rotas.

## 3. Requisitos funcionais

### RF-01: Dependência de hash de senha
- O projeto deve declarar a dependência **`bcryptjs`** (e a tipagem correspondente, se necessária).
- Nenhuma outra dependência deve ser adicionada nesta etapa (sem JWT, Passport, Swagger etc.).

### RF-02: Módulo de autenticação
- Deve existir um módulo **`AuthModule`**, com um **controller** e um **service** próprios, registrado no módulo raiz.
- O `AuthModule` cuida do fluxo de autenticação (nesta spec, só o cadastro). O acesso aos dados de usuário (buscar por e-mail, salvar) continua pertencendo ao módulo `users`, que deve disponibilizar essas operações para o `AuthModule`.
- O controller do `AuthModule` responde no prefixo de rota **`/auth`**.

### RF-03: Endpoint de cadastro
- Método e rota: **`POST /auth/register`**.
- Corpo da requisição: JSON conforme o DTO da seção 4.1.
- Em caso de sucesso, responde **201 Created** com o usuário criado no formato da seção 4.2.

### RF-04: Validação dos dados de entrada
- Todos os campos do DTO (seção 4.1) devem ser validados **antes** de qualquer acesso ao banco.
- Se houver qualquer erro, a requisição é rejeitada com **400 Bad Request** e **nada** é gravado.
- A resposta 400 deve listar **todos** os erros encontrados (não só o primeiro), cada um com uma mensagem clara, em português, que diga qual campo falhou e por quê (ver seção 4.3).
- Propriedades não previstas no DTO (por exemplo `status`, `id`, `createdAt`) devem fazer a requisição ser rejeitada com 400, conforme o `ValidationPipe` global já configurado. O cliente **não** consegue definir o próprio status nem o próprio id.

### RF-05: E-mail único
- Antes de criar o usuário, o serviço deve verificar se já existe um usuário com o mesmo e-mail.
- Se existir, a requisição é rejeitada com **409 Conflict** e nenhum registro é criado ou alterado.
- Se dois cadastros com o mesmo e-mail chegarem ao mesmo tempo e a verificação prévia passar nos dois, a violação de unicidade do banco também deve resultar em **409** (nunca em 500).

### RF-06: Hash da senha
- A senha recebida deve ser transformada em hash com **bcrypt, 10 salt rounds**, antes de ser gravada.
- A coluna `password` guarda **somente** o hash. A senha em texto puro nunca é gravada no banco nem escrita em log.

### RF-07: Status automático
- Todo usuário criado por este endpoint tem `status = active`, definido pelo próprio serviço.
- O valor de `status` não vem do cliente (ver RF-04).

### RF-08: Resposta sem senha
- Nenhuma resposta deste endpoint (sucesso ou erro) pode conter o campo `password`, nem em texto puro nem como hash.
- Mensagens de erro não devem repetir a senha enviada.

## 4. Estrutura de dados

### 4.1 DTO de entrada: `RegisterDto` (cadastro de usuário)

| Campo       | Tipo   | Obrigatório | Regras                                         | Mensagem de erro esperada (exemplo)                          |
| ----------- | ------ | ----------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `email`     | string | sim         | Deve ser um e-mail válido.                     | `email é obrigatório` / `email deve ser um e-mail válido`    |
| `password`  | string | sim         | Mínimo de **6** caracteres.                    | `password é obrigatório` / `password deve ter no mínimo 6 caracteres` |
| `firstName` | string | sim         | Não pode ser vazio. Máximo de **100** caracteres. | `firstName é obrigatório` / `firstName deve ter no máximo 100 caracteres` |
| `lastName`  | string | sim         | Não pode ser vazio. Máximo de **100** caracteres. | `lastName é obrigatório` / `lastName deve ter no máximo 100 caracteres` |
| `role`      | enum   | sim         | Só aceita `seller` ou `buyer`.                 | `role é obrigatório` / `role deve ser seller ou buyer`       |

Regras gerais:
- Todos os campos devem ser do tipo string; outro tipo (número, objeto, `null`) é erro de validação.
- Nenhum outro campo é aceito.

Exemplo de corpo válido:

```json
{
  "email": "maria@example.com",
  "password": "senha123",
  "firstName": "Maria",
  "lastName": "Silva",
  "role": "buyer"
}
```

### 4.2 Resposta de sucesso (201)

| Campo       | Tipo              | Observação                         |
| ----------- | ----------------- | ---------------------------------- |
| `id`        | UUID              | Gerado pelo banco.                 |
| `email`     | string            | Como foi gravado.                  |
| `firstName` | string            |                                    |
| `lastName`  | string            |                                    |
| `role`      | `seller`\|`buyer` |                                    |
| `status`    | `active`          | Sempre `active` neste endpoint.    |
| `createdAt` | data/hora ISO 8601 |                                   |
| `updatedAt` | data/hora ISO 8601 |                                   |

O campo `password` **não** aparece.

Exemplo:

```json
{
  "id": "3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90",
  "email": "maria@example.com",
  "firstName": "Maria",
  "lastName": "Silva",
  "role": "buyer",
  "status": "active",
  "createdAt": "2026-10-10T14:00:00.000Z",
  "updatedAt": "2026-10-10T14:00:00.000Z"
}
```

### 4.3 Respostas de erro

As respostas de erro seguem o formato padrão de exceções HTTP do NestJS: `statusCode`, `message` e `error`.

| Status | Quando                                         | `message`                                       | `error`         |
| ------ | ---------------------------------------------- | ----------------------------------------------- | --------------- |
| 400    | Algum campo inválido, ausente ou não previsto. | **Lista** com uma mensagem por erro encontrado. | `Bad Request`   |
| 409    | E-mail já cadastrado.                          | Texto único, ex.: `Email já cadastrado`.        | `Conflict`      |

Exemplo de 400:

```json
{
  "statusCode": 400,
  "message": [
    "email deve ser um e-mail válido",
    "password deve ter no mínimo 6 caracteres",
    "role deve ser seller ou buyer"
  ],
  "error": "Bad Request"
}
```

Exemplo de 409:

```json
{
  "statusCode": 409,
  "message": "Email já cadastrado",
  "error": "Conflict"
}
```

### 4.4 Estrutura de pastas esperada (alto nível)

```
src/
├── auth/               → AuthModule (novo)
│   ├── dto/            → RegisterDto
│   ├── auth.controller
│   ├── auth.service
│   └── auth.module
├── users/              → já existe; passa a oferecer buscar por e-mail e criar usuário
├── app.module          → registra o AuthModule
└── main
```

## 5. Fluxo do cadastro

1. O cliente envia `POST /auth/register` com o corpo da seção 4.1.
2. A validação roda. Se falhar → **400** com a lista de erros. Fim.
3. O serviço procura um usuário com o e-mail informado. Se encontrar → **409**. Fim.
4. A senha é transformada em hash (bcrypt, 10 rounds).
5. O usuário é gravado com o hash, os dados recebidos e `status = active`.
6. Se o banco recusar por e-mail duplicado (cadastro simultâneo) → **409**. Fim.
7. O serviço responde **201** com o usuário criado, sem `password`.

## 6. Fora do escopo

Fica para specs futuras:
- Login (`POST /login`), JWT, sessões e validação de token (`GET /session/validate/:token`).
- Guards, proteção de rotas e autorização por role.
- Confirmação de e-mail, recuperação de senha, regras de força de senha além do tamanho mínimo.
- Atualização, listagem, desativação ou remoção de usuários.
- Publicação de eventos (RabbitMQ) sobre o usuário criado.
- Swagger e documentação de API.
- Ajustes no api-gateway (ver seção 8).

## 7. Critérios de aceite

| #     | Critério                                                                                                                                  | Como verificar                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CA-01 | O `package.json` declara `bcryptjs`, e nenhuma dependência de JWT/Passport foi adicionada.                                                 | Ler o `package.json`.                                                                            |
| CA-02 | Existe o `AuthModule` com controller e service, registrado no módulo raiz, e a rota `POST /auth/register` aparece nos logs de inicialização. | Iniciar a aplicação e conferir o mapeamento de rotas no console.                                 |
| CA-03 | Um cadastro com o corpo de exemplo da seção 4.1 retorna **201** com os 8 campos da seção 4.2.                                              | Requisição HTTP e conferência do corpo.                                                          |
| CA-04 | A resposta 201 **não** contém o campo `password`.                                                                                          | Conferir que a chave `password` não existe no JSON.                                              |
| CA-05 | O usuário criado tem `status = active` na resposta e no banco.                                                                            | Resposta HTTP + consulta na tabela `users`.                                                      |
| CA-06 | No banco, a coluna `password` do usuário criado é diferente da senha enviada e tem formato de hash bcrypt com custo 10 (começa com `$2a$10$` ou `$2b$10$`). | Consulta na tabela `users`.                                                                      |
| CA-07 | O hash gravado confere com a senha original quando comparado com bcrypt.                                                                   | Teste unitário ou comparação manual.                                                             |
| CA-08 | Cadastrar de novo com um e-mail já existente retorna **409** com `error = Conflict`, e a tabela continua com um único registro desse e-mail. | Duas requisições seguidas + contagem no banco.                                                   |
| CA-09 | Corpo vazio retorna **400** com uma mensagem para cada um dos 5 campos obrigatórios.                                                       | Requisição com `{}`.                                                                             |
| CA-10 | `email` inválido (ex.: `maria@`) retorna **400** com mensagem sobre o e-mail.                                                              | Requisição HTTP.                                                                                 |
| CA-11 | `password` com 5 caracteres retorna **400**; com exatamente 6 caracteres é aceito.                                                         | Duas requisições (limite inferior).                                                              |
| CA-12 | `firstName` ou `lastName` com 101 caracteres retorna **400**; com exatamente 100 caracteres é aceito.                                     | Requisições nos limites.                                                                         |
| CA-13 | `role` diferente de `seller`/`buyer` (ex.: `admin`, `user`) retorna **400**.                                                               | Requisição HTTP.                                                                                 |
| CA-14 | Enviar campos extras (ex.: `status: "inactive"` ou `id`) retorna **400** e nada é gravado.                                                | Requisição HTTP + consulta no banco.                                                             |
| CA-15 | Um corpo com vários erros ao mesmo tempo retorna **todos** eles na lista `message`, não só o primeiro.                                     | Requisição com e-mail, senha e role inválidos.                                                   |
| CA-16 | Nenhuma resposta de erro (400 ou 409) contém a senha enviada nem o hash.                                                                  | Conferir os corpos das respostas de erro.                                                        |
| CA-17 | Dois cadastros simultâneos com o mesmo e-mail resultam em um **201** e um **409**, nunca em **500**.                                      | Teste com requisições em paralelo (ou teste unitário simulando a violação de unicidade do banco). |
| CA-18 | Existem testes unitários do service de autenticação cobrindo: sucesso, e-mail duplicado (409), hash da senha e ausência de `password` no retorno. | `pnpm run test` passa.                                                                           |
| CA-19 | `pnpm run build` e `pnpm run lint` terminam sem erros.                                                                                    | Rodar os comandos.                                                                               |

## 8. Pontos de atenção

- **Divergência com o api-gateway:** o `RegisterDto` do gateway ainda usa as roles `user`, `admin` e `seller`, com `role` opcional e padrão `user`, e não limita tamanho de nome nem de senha. Com esta spec, um cadastro feito pelo gateway sem `role` ou com `role = user` vai receber **400** do users-service. O gateway também transforma qualquer erro do users-service em 401, perdendo o 400/409. O alinhamento do gateway fica para uma spec própria.
- **Maiúsculas e minúsculas no e-mail:** esta spec não define normalização. Hoje `Maria@Example.com` e `maria@example.com` seriam tratados como e-mails diferentes. Vale decidir isso antes da spec de login.
- **Tamanho das colunas:** o limite de 100 caracteres para `firstName` e `lastName` é garantido pela validação de entrada. As colunas da entidade não têm limite definido; alinhar o banco a esse limite é opcional e pode ficar para depois.

## 9. Commits

Faça sempre um commit após cada implementação desta spec.
