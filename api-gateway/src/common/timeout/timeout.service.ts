import { Injectable, Logger } from '@nestjs/common';
import { TimeoutOptions } from './timeout.interface';

@Injectable()
export class TimeoutService {
  private readonly logger = new Logger(TimeoutService.name);

  private readonly defaultOptions: TimeoutOptions = {
    timeout: 5000, // cada tentativa dura 5 segundos
    retries: 3, // até 3 tentativas
    backoffMultiplier: 2, // dobra o tempo entre requisições
    maxBackoff: 30000, // Nunca espera mais que 30 segundos em cada tentativa
  };

  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    options: Partial<TimeoutOptions> = {},
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    const retry = await this.executeWithRetry(operation, config);
    return retry;
  }

  // esse função é responsavel pelo timeout
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: TimeoutOptions,
  ): Promise<T> {
    let lastError: Error;
    let delay = 1000; // 1 segundo entre as requisições

    // faz o laço de repetição enquanto ele for menor que o valor de retries
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        this.logger.debug(`Attempt ${attempt + 1}/${options.retries + 1}`);
        // O Promise.race é usado para cancelar uma operação se ela demorar mais que o timeout
        // ela olha e devolve qual Promise vai executar primeiro entre a operação ou createTimeoutPromise
        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise(options.timeout),
        ]);

        if (attempt > 0) {
          this.logger.log(`Operation succeeded on attempt ${attempt + 1}`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt + 1} failed: ${lastError.message}`);

        if (attempt < options.retries) {
          await this.delay(delay); // espero 1 segundo
          delay = Math.min(
            // depois vou multiplicando esse 1 segundo por 2 até dar 30 segundos
            delay * options.backoffMultiplier,
            options.maxBackoff,
          );
        }
      }
    }
    // se tudo falhar, gero um erro
    this.logger.error(`All ${options.retries + 1} attempts failed`);

    throw lastError!;
  }
  // cria uma função que nunca resolve
  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async executeWithCustomTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([operation(), this.createTimeoutPromise(timeoutMs)]);
  }
}
