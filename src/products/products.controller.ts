import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/auth.guard';
import { segment } from '../common/utils/path-segment';
import { ProxyService } from '../proxy/service/proxy.service';

// schema só para documentação: o corpo segue intacto e quem valida é o products-service
const createProductSchema = {
  type: 'object',
  required: ['name', 'description', 'price', 'stock'],
  properties: {
    name: { type: 'string', maxLength: 255, example: 'Teclado mecânico' },
    description: {
      type: 'string',
      example: 'Teclado mecânico ABNT2 com switches marrons',
    },
    price: {
      type: 'number',
      minimum: 0.01,
      maximum: 99999999.99,
      example: 349.9,
    },
    stock: { type: 'integer', minimum: 0, example: 15 },
  },
};

// GETs públicos; só o POST passa pelo JwtAuthGuard (role seller é checada no products-service)
@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cria um produto (apenas sellers)' })
  @ApiBody({ schema: createProductSchema })
  @ApiResponse({ status: 201, description: 'Produto criado' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @ApiResponse({ status: 403, description: 'Usuário não é seller' })
  @ApiResponse({ status: 503, description: 'products-service indisponível' })
  create(
    // Record (metatype Object): o ValidationPipe global não valida nem remove campos
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    // repassa o Authorization original: o products-service também valida o token
    return this.proxyService.proxyRequest(
      'products',
      'post',
      '/products',
      body,
      { authorization },
      user,
    );
  }

  // rotas estáticas e com prefixo declaradas antes da dinâmica (:id)

  @Get()
  @ApiOperation({ summary: 'Lista os produtos ativos' })
  @ApiResponse({ status: 200, description: 'Array de produtos ativos' })
  findAll() {
    return this.proxyService.proxyRequest('products', 'get', '/products');
  }

  @Get('seller/:sellerId')
  @ApiOperation({ summary: 'Lista os produtos ativos de um vendedor' })
  @ApiParam({ name: 'sellerId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array de produtos do vendedor' })
  @ApiResponse({ status: 400, description: 'sellerId não é UUID' })
  findBySeller(@Param('sellerId') sellerId: string) {
    return this.proxyService.proxyRequest(
      'products',
      'get',
      `/products/seller/${segment(sellerId)}`,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um produto pelo ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Produto encontrado' })
  @ApiResponse({ status: 400, description: 'id não é UUID' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  findOne(@Param('id') id: string) {
    return this.proxyService.proxyRequest(
      'products',
      'get',
      `/products/${segment(id)}`,
    );
  }
}
