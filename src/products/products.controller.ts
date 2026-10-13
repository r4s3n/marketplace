import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

// valida o parâmetro antes do banco: sem isso, um id malformado vira 500 no pg
const uuidPipe = (param: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException(`${param} deve ser um UUID válido`),
  });

// POST protegido pelo guard global (regra de role no service); GETs públicos
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

  // ordem importa: rotas estáticas e com prefixo antes de :id

  @Public()
  @Get()
  findAll(): Promise<Product[]> {
    return this.productsService.findAll();
  }

  @Public()
  @Get('seller/:sellerId')
  findBySeller(
    @Param('sellerId', uuidPipe('sellerId')) sellerId: string,
  ): Promise<Product[]> {
    return this.productsService.findBySeller(sellerId);
  }

  @Public()
  @Get(':id') // sempre a última rota GET
  findOne(@Param('id', uuidPipe('id')) id: string): Promise<Product> {
    return this.productsService.findOne(id);
  }
}
