# Marketplace — Microserviços

Marketplace construído com arquitetura de microserviços em **NestJS**, **PostgreSQL** e **RabbitMQ**.
Cada serviço é independente: tem o próprio `package.json`, banco de dados, `.env` e `docker-compose.yaml`.

## Arquitetura

```
                        ┌──────────────────┐
   Cliente ───────────▶ │   api-gateway    │  :3005  (valida JWT, roteia)
                        └────────┬─────────┘
          ┌──────────────────────┼───────────────────────┐
          ▼                      ▼                       ▼
 ┌─────────────────┐   ┌──────────────────┐   ┌───────────────────┐
 │  users-service  │   │ products-service │   │ checkout-service  │
 │      :3000      │   │      :3001       │   │       :3003       │
 └────────┬────────┘   └────────┬─────────┘   └─────────┬─────────┘
          │                     │                       │ publica pagamento
       users-db              products-db           checkout-db
        :5433                  :5436                  :5435
                                                        ▼
                                          ┌──────────────────────────┐
                                          │  RabbitMQ (messaging)    │ :5672 / :15672
                                          └────────────┬─────────────┘
                                                       ▼ consome
                                          ┌──────────────────────────┐
                                          │    payments-service      │ :3004
                                          └────────────┬─────────────┘
                                                   payments-db :5434
```

| Serviço | Porta | Responsabilidade |
| --- | --- | --- |
| [api-gateway](api-gateway) | 3005 | Ponto de entrada único; valida o JWT e encaminha as requisições aos serviços |
| [users-service](users-service) | 3000 | Cadastro, login e emissão de JWT; perfis de compradores e vendedores |
| [products-service](products-service) | 3001 | Catálogo de produtos por vendedor |
| [checkout-service](checkout-service) | 3003 | Carrinho e finalização de pedidos; publica o pagamento no RabbitMQ |
| [payments-service](payments-service) | 3004 | Consome a fila de pagamentos, com DLQ, reprocessamento e métricas |
| [messaging-service](messaging-service) | 5672 / 15672 | Infraestrutura do RabbitMQ (docker-compose) |

## Como rodar

Pré-requisitos: Node.js, pnpm e Docker.

```bash
# 1. Mensageria
cd messaging-service && docker compose up -d && cd ..

# 2. Para cada serviço (users, products, checkout, payments, api-gateway)
cd users-service
cp .env.example .env        # preencha as variáveis
docker compose up -d        # sobe o Postgres do serviço (o api-gateway não tem banco)
pnpm install
pnpm start:dev
```

> O `JWT_SECRET` precisa ser **o mesmo** no `users-service`, `products-service`, `checkout-service` e `api-gateway`.

## Estrutura do repositório

Monorepo: cada pasta na raiz é um microserviço independente, com histórico de commits preservado.
Os serviços se comunicam apenas pela rede (HTTP via gateway e eventos via RabbitMQ) — nenhum importa código de outro.
