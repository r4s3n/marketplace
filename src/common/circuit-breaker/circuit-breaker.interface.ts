export enum CircuitBreakerStateEnum {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // numero maximo de falhas consecutivas
  timeout: number; // duranção em milisegundos que a chamada individual deve esperar antes de ser cnsiderada uma falha
  resetTimeout: number; // duração que o circuit breaker permanece no estado open
}

export interface CircuitBreakerState {
  state: CircuitBreakerStateEnum; // estado do circuit breaker
  failureCount: number; // numero de falhas
  lastFailureTime: number; // ultima falha data
  nextAttemptTime: number; // timestamp de quando a proxima tentantiva deve ocorrer
}

export interface CircuitBreakerResult<T> {
  success: boolean; // se teve sucesso ou não
  data?: T; // informação se tiver
  error?: Error; // se tiver erro em nosso circuit breaker
  fromCache?: boolean; // me informa se o resultado data ou error veio do cache ou do fallback

  //obs: quando formos passar esse interface, temos que tipar o generics, pois o generics será o tipo de dada que iremos receber
}
