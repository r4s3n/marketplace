import {
  Body,
  Controller,
  Delete,
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
import { segment } from '../common/utils/path-segment';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

// schema só para documentação: o corpo segue intacto e quem valida é o checkout-service
const addCartItemSchema = {
  type: 'object',
  required: ['productId', 'quantity'],
  properties: {
    productId: {
      type: 'string',
      format: 'uuid',
      example: 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f',
    },
    quantity: { type: 'integer', minimum: 1, example: 2 },
  },
};

// todas as rotas exigem JWT; o dono do carrinho é definido pelo checkout-service a partir do token
@ApiTags('Checkout')
@ApiBearerAuth('JWT-auth')
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@ApiResponse({ status: 503, description: 'checkout-service indisponível' })
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  // repassa o Authorization original: o checkout-service também valida o token
  private forward(
    method: 'get' | 'post' | 'delete',
    path: string,
    authorization: string,
    user: JwtUser,
    body?: Record<string, unknown>,
  ) {
    return this.proxyService.proxyRequest(
      'checkout',
      method,
      path,
      body,
      { authorization },
      user,
    );
  }

  @Post('items')
  @ApiOperation({ summary: 'Adiciona um produto ao carrinho' })
  @ApiBody({ schema: addCartItemSchema })
  @ApiResponse({ status: 201, description: 'Carrinho atualizado' })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou produto indisponível',
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  addItem(
    // Record (metatype Object): o ValidationPipe global não valida nem remove campos
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('post', '/cart/items', authorization, user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Mostra o carrinho ativo do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Carrinho ativo, ou carrinho vazio com id null',
  })
  getCart(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('get', '/cart', authorization, user);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove um item do carrinho' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Carrinho atualizado' })
  @ApiResponse({ status: 400, description: 'itemId não é UUID' })
  @ApiResponse({ status: 404, description: 'Item não encontrado no carrinho' })
  removeItem(
    @Param('itemId') itemId: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward(
      'delete',
      `/cart/items/${segment(itemId)}`,
      authorization,
      user,
    );
  }
}
