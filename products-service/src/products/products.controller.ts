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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post() // responde 201 por padrão
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cria um produto (apenas sellers)' })
  @ApiResponse({ status: 201, description: 'Produto criado', type: Product })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @ApiResponse({ status: 403, description: 'Usuário não é seller' })
  create(
    @Body() dto: CreateProductDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<Product> {
    return this.productsService.create(dto, req.user);
  }

  // ordem importa: rotas estáticas e com prefixo antes de :id

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista os produtos ativos' })
  @ApiResponse({
    status: 200,
    description: 'Produtos ativos, mais recentes primeiro',
    type: [Product],
  })
  findAll(): Promise<Product[]> {
    return this.productsService.findAll();
  }

  @Public()
  @Get('seller/:sellerId')
  @ApiOperation({ summary: 'Lista os produtos ativos de um vendedor' })
  @ApiParam({ name: 'sellerId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Produtos ativos do vendedor',
    type: [Product],
  })
  @ApiResponse({ status: 400, description: 'sellerId não é UUID' })
  findBySeller(
    @Param('sellerId', uuidPipe('sellerId')) sellerId: string,
  ): Promise<Product[]> {
    return this.productsService.findBySeller(sellerId);
  }

  @Public()
  @Get(':id') // sempre a última rota GET
  @ApiOperation({ summary: 'Busca um produto pelo ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Produto encontrado',
    type: Product,
  })
  @ApiResponse({ status: 400, description: 'id não é UUID' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  findOne(@Param('id', uuidPipe('id')) id: string): Promise<Product> {
    return this.productsService.findOne(id);
  }
}
