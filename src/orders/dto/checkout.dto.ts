import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaymentMethod } from '../enums/payment-method.enum';

const PAYMENT_METHOD_MESSAGE: string = `paymentMethod deve ser um dos valores: ${Object.values(PaymentMethod).join(', ')}`;

// userId, cartId, total e itens não vêm do cliente: saem do carrinho ativo
export class CheckoutDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod, { message: PAYMENT_METHOD_MESSAGE })
  paymentMethod: PaymentMethod;
}
