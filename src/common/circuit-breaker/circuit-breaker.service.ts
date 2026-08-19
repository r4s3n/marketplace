import { Injectable, Logger } from '@nestjs/common';
import {
  CircuitBreakerOptions,
  CircuitBreakerState,
  CircuitBreakerStateEnum,
} from './circuit-breaker.interface';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger('CircuitBreaker'); // logs do serviço
  private readonly circuits = new Map<string, CircuitBreakerState>(); // armazena o estado atual do serviço
  private readonly defaultOptions: CircuitBreakerOptions = {
    failureThreshold: 5,
    timeout: 60000,
    resetTimeout: 30000,
  }; // configuração default do nosso circuitBreaker

  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>, // operação a ser executada
    fallback?: () => Promise<T>, // operação de erro
    key?: string,
    options: CircuitBreakerOptions = this.defaultOptions,
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    const circuit = this.getOrCreateCircuit(key!, config);

    // Verifico se o circuit breaker está aberto, se não, mudo o estado para semi aberto
    if (circuit.state === CircuitBreakerStateEnum.OPEN) {
      if (Date.now() < circuit.nextAttemptTime) {
        this.logger.warn(`Circuit breaker OPEN for ${key}, using fallback`);
        if (fallback) {
          return await fallback();
        }
        throw new Error('Circuit breaker OPEN');
      } else {
        circuit.state = CircuitBreakerStateEnum.HALF_OPEN;
        this.logger.warn(
          `Circuit breaker HALF_OPEN for ${key}, using fallback`,
        );
      }
    }

    // faço um tryCatch para ver se a minha operação teve sucesso ou geral algum erro
    try {
      const result = await operation(); // faço a aoperação
      this.onSuccess(circuit, key!); // se ela tiver sucesso, chamo minha função onSuccess
      return result; // e retorno ela
    } catch (error: any) {
      this.onFailure(circuit, key!, config); // caso a operação dar errado, chamo a minha função failure
      this.logger.error(`Circuit breaker failure ${key}:`, error.message);
      // e se tiver alguma operação de erro, retorno ela, se não, retorno o erro
      if (fallback) {
        this.logger.warn(`Using fallback to ${key}`);
        return await fallback();
      }
      throw error;
    }
  }

  // essa função verifica se o Circuit já existe, se não existir, cria um novo
  private getOrCreateCircuit(
    key: string,
    options: CircuitBreakerOptions,
  ): CircuitBreakerState {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: CircuitBreakerStateEnum.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: Date.now() + options.timeout,
      });
    }

    return this.circuits.get(key)!;
  }

  private onSuccess(circuit: CircuitBreakerState, key: string): void {
    circuit.failureCount = 0;
    circuit.state = CircuitBreakerStateEnum.CLOSED;
    this.logger.debug(`Circuit breaker SUCCESS from ${key}, state: CLOSED`);
  }

  private onFailure(
    circuit: CircuitBreakerState,
    key: string,
    options: CircuitBreakerOptions,
  ): void {
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();
    if (circuit.failureCount >= options.failureThreshold) {
      circuit.state = CircuitBreakerStateEnum.OPEN;
      circuit.nextAttemptTime = Date.now() + options.resetTimeout;
      this.logger.warn(
        `Circuit breaker OPENED for ${key} after ${circuit.failureCount} failures`,
      );
    }
  }

  // pego o estado do meu Circuit Breaker
  getCircuitState(key: string): CircuitBreakerState | undefined {
    return this.circuits.get(key);
  }
  // pego todos os meus circuits breakers
  getCircuits(): Map<string, CircuitBreakerState> {
    return new Map(this.circuits);
  }

  // caso seja necessario, a gente deleta o circuit para que depois seja criado um novo
  resetCircuit(key: string): void {
    this.circuits.delete(key);
    this.logger.log(`Circuit breaker RESET for ${key}`);
  }
}
