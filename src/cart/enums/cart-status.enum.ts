// ciclo de vida do carrinho: só um carrinho active por usuário nas próximas specs
export enum CartStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}
