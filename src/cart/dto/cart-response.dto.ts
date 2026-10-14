import { ApiProperty } from '@nestjs/swagger';
import { CartStatus } from '../enums/cart-status.enum';

// @ApiProperty só documenta a resposta no Swagger
export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ example: 'Teclado mecânico' })
  productName: string;

  @ApiProperty({ example: 19.99, description: 'Preço unitário na adição' })
  price: number;

  @ApiProperty({ type: 'integer', example: 3 })
  quantity: number;

  @ApiProperty({ example: 59.97 })
  subtotal: number;

  @ApiProperty()
  createdAt: Date;
}

export class CartResponseDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'null quando o usuário ainda não tem carrinho ativo',
  })
  id: string | null;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: CartStatus, example: CartStatus.ACTIVE })
  status: CartStatus;

  @ApiProperty({ example: 59.97 })
  total: number;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty({ nullable: true, type: Date })
  createdAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  updatedAt: Date | null;
}
