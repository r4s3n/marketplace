import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Product } from './interfaces/product.interface';

export const PRODUCT_NOT_FOUND = 'Produto não encontrado';
export const PRODUCTS_SERVICE_UNAVAILABLE = 'Serviço de produtos indisponível';

// resposta crua do products-service: decimais podem chegar como texto
type ProductResponse = Omit<Product, 'price' | 'stock'> & {
  price: number | string;
  stock: number | string;
};

// rota pública do products-service: não envia token
@Injectable()
export class ProductsClientService {
  private readonly logger = new Logger(ProductsClientService.name);

  constructor(private readonly http: HttpService) {}

  // devolve ativos e inativos: quem chama decide o que fazer com isActive
  async getProduct(productId: string): Promise<Product> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<ProductResponse>(
          `/products/${encodeURIComponent(productId)}`,
        ),
      );
      return {
        id: data.id,
        name: data.name,
        price: Number(data.price),
        stock: Number(data.stock),
        isActive: data.isActive,
        sellerId: data.sellerId,
      };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException(PRODUCT_NOT_FOUND);
      }
      // motivo técnico só no log, nunca na resposta ao cliente
      const reason = isAxiosError(error)
        ? `${error.code ?? ''} ${error.response?.status ?? ''} ${error.message}`.trim()
        : String(error);
      this.logger.error(
        `Falha ao buscar o produto ${productId} no products-service: ${reason}`,
      );
      throw new ServiceUnavailableException(PRODUCTS_SERVICE_UNAVAILABLE);
    }
  }
}
