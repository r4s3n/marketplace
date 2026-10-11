import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'maria@example.com' })
  @IsNotEmpty({ message: 'email é obrigatório' })
  @IsString({ message: 'email deve ser um texto' })
  @IsEmail({}, { message: 'email deve ser um e-mail válido' })
  email: string;

  @ApiProperty({ example: 'senha123', minLength: 6 })
  @IsNotEmpty({ message: 'password é obrigatório' })
  @IsString({ message: 'password deve ser um texto' })
  @MinLength(6, { message: 'password deve ter no mínimo 6 caracteres' })
  password: string;
}
