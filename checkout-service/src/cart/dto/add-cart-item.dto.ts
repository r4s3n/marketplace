import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

const QUANTITY_MESSAGE =
  'quantity deve ser um número inteiro maior ou igual a 1';

// preço e nome não vêm do cliente: são buscados no products-service
export class AddCartItemDto {
  @ApiProperty({
    format: 'uuid',
    example: 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f',
  })
  @IsUUID(undefined, { message: 'productId deve ser um UUID válido' })
  productId: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 2 })
  @IsInt({ message: QUANTITY_MESSAGE }) // texto como "2" não é aceito
  @Min(1, { message: QUANTITY_MESSAGE })
  quantity: number;
}
