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
import { segment } from '../common/utils/path-segment';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

// schema só para documentação: o corpo segue intacto e quem valida é o checkout-service
const checkoutSchema = {
  type: 'object',
  required: ['paymentMethod'],
  properties: {
    paymentMethod: {
      type: 'string',
      enum: ['credit_card', 'debit_card', 'pix', 'boleto'],
      example: 'pix',
    },
  },
};

// sem prefixo: o controller atende /cart/checkout e /orders, todas com JWT
@ApiTags('Checkout')
@ApiBearerAuth('JWT-auth')
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@ApiResponse({ status: 503, description: 'checkout-service indisponível' })
@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  // repassa o Authorization original: o checkout-service também valida o token
  private forward(
    method: 'get' | 'post',
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

  @Post('cart/checkout')
  @ApiOperation({ summary: 'Finaliza o carrinho ativo e cria o pedido' })
  @ApiBody({ schema: checkoutSchema })
  @ApiResponse({ status: 201, description: 'Pedido criado com status pending' })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou carrinho vazio',
  })
  checkout(
    // Record (metatype Object): o ValidationPipe global não valida nem remove campos
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('post', '/cart/checkout', authorization, user, body);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Lista os pedidos do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Pedidos do mais recente para o mais antigo',
  })
  findAll(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('get', '/orders', authorization, user);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Mostra um pedido do usuário' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pedido' })
  @ApiResponse({ status: 400, description: 'id não é UUID' })
  @ApiResponse({ status: 404, description: 'Pedido não encontrado' })
  findOne(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('get', `/orders/${segment(id)}`, authorization, user);
  }
}
