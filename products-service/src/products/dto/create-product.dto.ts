import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// limites das colunas: decimal(10,2) e int de 32 bits; acima disso o banco daria 500
export const PRICE_MIN = 0.01;
export const PRICE_MAX = 99999999.99;
export const STOCK_MAX = 2147483647;

// sellerId e isActive não entram no DTO: vêm do token e do service
export class CreateProductDto {
  @ApiProperty({ example: 'Teclado mecânico', maxLength: 255 })
  @IsNotEmpty({ message: 'name é obrigatório' })
  @IsString({ message: 'name deve ser um texto' })
  @MaxLength(255, { message: 'name deve ter no máximo 255 caracteres' })
  name: string;

  @ApiProperty({ example: 'Teclado mecânico ABNT2 com switches marrons' })
  @IsNotEmpty({ message: 'description é obrigatório' })
  @IsString({ message: 'description deve ser um texto' })
  description: string;

  @ApiProperty({
    example: 349.9,
    minimum: PRICE_MIN,
    maximum: PRICE_MAX,
    description: 'No máximo 2 casas decimais',
  })
  @IsNotEmpty({ message: 'price é obrigatório' })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'price deve ser um número com no máximo 2 casas decimais' },
  )
  @Min(PRICE_MIN, { message: `price deve ser no mínimo ${PRICE_MIN}` })
  @Max(PRICE_MAX, { message: `price deve ser no máximo ${PRICE_MAX}` })
  price: number;

  @ApiProperty({ type: 'integer', example: 15, minimum: 0, maximum: STOCK_MAX })
  @IsNotEmpty({ message: 'stock é obrigatório' })
  @IsInt({ message: 'stock deve ser um número inteiro' })
  @Min(0, { message: 'stock deve ser no mínimo 0' })
  @Max(STOCK_MAX, { message: `stock deve ser no máximo ${STOCK_MAX}` })
  stock: number;
}
