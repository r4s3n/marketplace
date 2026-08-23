export interface RetryOptions {
  maxRetries: number; // numero maximo de tentativas add apos a falha adicional
  baseDelay: number; // delay base
  maxDelay: number; // o maximo de delay da aplicação
  backoffMultiplier: number; // multiplicador do backoff(delay)
  jitter: boolean; // se true, evita o thundering herd adicionando variação aleatoria ao delay
}

// encapsula o retorno do retry
export interface RetryResult<T> {
  success: boolean; // retorna o resultado do retry
  data?: T; // se tiver algum dado, retorna
  error?: Error; // se tiver algum erro, retorna
  attempts: number; // numero de tantativas
  totalTime: number; // total de tempo do retry
}
