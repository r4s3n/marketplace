import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';

export const ONLY_SELLERS = 'Apenas vendedores podem criar produtos';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  // sellerId vem do token, nunca do corpo da requisição
  create(dto: CreateProductDto, user: AuthenticatedUser): Promise<Product> {
    if (user.role !== UserRole.SELLER) {
      throw new ForbiddenException(ONLY_SELLERS);
    }

    const product = this.productsRepository.create({
      ...dto,
      sellerId: user.id,
      isActive: true,
    });
    return this.productsRepository.save(product);
  }
}
