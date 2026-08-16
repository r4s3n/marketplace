import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email do usuário',
    example: 'user@exemple.com',
  }) // mapear pro swagger
  @IsEmail() //valido o email
  email!: string;

  @ApiProperty({
    description: 'Senha do usuário',
    example: 'password123',
    minLength: 6,
  }) // mapear pro swagger
  @IsString() //valido a senha é string
  @IsNotEmpty() // valido se não está vazio
  password!: string;
}
