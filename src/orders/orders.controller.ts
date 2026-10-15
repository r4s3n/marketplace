import { Controller, Get, Param, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { uuidPipe } from '../common/pipes/uuid.pipe';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

// protegido pelo guard global; o dono dos pedidos é sempre req.user.id
@ApiTags('Orders')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os pedidos do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Pedidos do mais recente para o mais antigo',
    type: [OrderResponseDto],
  })
  findAll(@Req() req: AuthenticatedRequest): Promise<OrderResponseDto[]> {
    return this.ordersService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Mostra um pedido do usuário' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Pedido', type: OrderResponseDto })
  @ApiResponse({ status: 400, description: 'id não é UUID' })
  @ApiResponse({ status: 404, description: 'Pedido não encontrado' })
  findOne(
    @Param('id', uuidPipe('id')) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOne(req.user.id, id);
  }
}
