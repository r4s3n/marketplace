import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

// protegido pelo guard global; a regra de role fica no service
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post() // responde 201 por padrão
  create(
    @Body() dto: CreateProductDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<Product> {
    return this.productsService.create(dto, req.user);
  }
}
