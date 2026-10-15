import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';

// @ApiProperty só documenta a resposta no Swagger
export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ example: 'Teclado mecânico' })
  productName: string;

  @ApiProperty({ example: 19.99, description: 'Preço unitário no fechamento' })
  price: number;

  @ApiProperty({ type: 'integer', example: 3 })
  quantity: number;

  @ApiProperty({ example: 59.97 })
  subtotal: number;

  @ApiProperty()
  createdAt: Date;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Carrinho que originou o pedido',
  })
  cartId: string;

  @ApiProperty({ example: 59.97 })
  total: number;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PENDING })
  status: OrderStatus;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  paymentMethod: PaymentMethod;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
