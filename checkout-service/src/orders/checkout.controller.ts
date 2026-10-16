import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

// fica no OrdersModule: se estivesse no CartController, CartModule e
// OrdersModule importariam um ao outro
@ApiTags('Orders')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('cart')
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout') // responde 201 por padrão
  @ApiOperation({ summary: 'Finaliza o carrinho ativo e cria o pedido' })
  @ApiResponse({
    status: 201,
    description: 'Pedido criado com status pending',
    type: OrderResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos ou carrinho vazio',
  })
  checkout(
    @Body() dto: CheckoutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrderResponseDto> {
    return this.ordersService.checkout(req.user.id, dto);
  }
}
