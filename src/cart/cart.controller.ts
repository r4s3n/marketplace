import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { uuidPipe } from '../common/pipes/uuid.pipe';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';

// protegido pelo guard global; o dono do carrinho é sempre req.user.id
@ApiTags('Cart')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Mostra o carrinho ativo do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Carrinho ativo, ou carrinho vazio com id null',
    type: CartResponseDto,
  })
  getCart(@Req() req: AuthenticatedRequest): Promise<CartResponseDto> {
    return this.cartService.getCart(req.user.id);
  }

  @Post('items') // responde 201 por padrão
  @ApiOperation({ summary: 'Adiciona um produto ao carrinho' })
  @ApiResponse({
    status: 201,
    description: 'Carrinho atualizado',
    type: CartResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos, produto indisponível ou limite excedido',
  })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  @ApiResponse({
    status: 503,
    description: 'Serviço de produtos indisponível',
  })
  addItem(
    @Body() dto: AddCartItemDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CartResponseDto> {
    return this.cartService.addItem(req.user.id, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove um item do carrinho' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Carrinho atualizado',
    type: CartResponseDto,
  })
  @ApiResponse({ status: 400, description: 'itemId não é UUID' })
  @ApiResponse({ status: 404, description: 'Item não encontrado no carrinho' })
  removeItem(
    @Param('itemId', uuidPipe('itemId')) itemId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CartResponseDto> {
    return this.cartService.removeItem(req.user.id, itemId);
  }
}
