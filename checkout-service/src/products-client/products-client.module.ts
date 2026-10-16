import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductsClientService } from './products-client.service';

// tempo máximo de espera por uma resposta do products-service
export const PRODUCTS_SERVICE_TIMEOUT_MS = 5000;

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // getOrThrow aceita string vazia: a checagem precisa ser explícita
        const baseURL = config.get<string>('PRODUCTS_SERVICE_URL');
        if (!baseURL) {
          throw new Error(
            'PRODUCTS_SERVICE_URL não configurada: defina a URL do products-service no .env',
          );
        }
        return { baseURL, timeout: PRODUCTS_SERVICE_TIMEOUT_MS };
      },
    }),
  ],
  providers: [ProductsClientService],
  exports: [ProductsClientService],
})
export class ProductsClientModule {}
