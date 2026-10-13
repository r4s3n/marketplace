import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';

export const ONLY_SELLERS = 'Apenas vendedores podem criar produtos';
export const PRODUCT_NOT_FOUND = 'Produto não encontrado';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  // sellerId vem do token, nunca do corpo da requisição
  async create(
    dto: CreateProductDto,
    user: AuthenticatedUser,
  ): Promise<Product> {
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

  // catálogo: só ativos, mais recentes primeiro
  findAll(): Promise<Product[]> {
    return this.productsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  // vendedor sem produtos ativos (ou inexistente) devolve []
  findBySeller(sellerId: string): Promise<Product[]> {
    return this.productsRepository.find({
      where: { sellerId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  // não filtra por isActive: quem consulta decide o que fazer com um inativo
  async findOne(id: string): Promise<Product> {
    const product = await this.productsRepository.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return product;
  }
}
