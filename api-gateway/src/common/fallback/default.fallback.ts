import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class defaultFallbackService {
  private readonly logger = new Logger(defaultFallbackService.name);

  // metodo de criar um valor de fallback que retorna um valor generico
  createDefaultFallback<T>(
    defaultReponse: T,
    serviceName: string,
  ): () => Promise<T> {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (): Promise<T> => {
      this.logger.warn(`Usinf default fallback for ${serviceName}`);
      return defaultReponse;
    };
  }

  // metodo de criar um erro
  createErrorFallback(
    serviceName: string,
    errorMessage: string,
  ): () => Promise<never> {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (): Promise<never> => {
      this.logger.error(`Fallback error for ${serviceName}: ${errorMessage}`);
      // 503 para o cliente, em vez de um Error genérico (500); o nome do serviço fica só no log
      throw new ServiceUnavailableException(errorMessage);
    };
  }

  // metodo para criar um array vazio -> usar para listas
  createEmptyArrayFallback<T>(serviceName: string): () => Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (): Promise<T[]> => {
      this.logger.warn(`Using empty array fallback for ${serviceName}`);

      return [];
    };
  }

  // metodo para criar um objeto vazio -. usar para objetos
  createEmptyObjectFallback<T>(serviceName: string): () => Promise<T> {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (): Promise<T> => {
      this.logger.warn(`Using empty object fallback for ${serviceName}`);

      return {} as T;
    };
  }
}
