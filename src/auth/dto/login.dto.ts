import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'email é obrigatório' })
  @IsString({ message: 'email deve ser um texto' })
  @IsEmail({}, { message: 'email deve ser um e-mail válido' })
  email: string;

  @IsNotEmpty({ message: 'password é obrigatório' })
  @IsString({ message: 'password deve ser um texto' })
  @MinLength(6, { message: 'password deve ter no mínimo 6 caracteres' })
  password: string;
}
