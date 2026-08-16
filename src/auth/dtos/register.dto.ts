import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

enum Role {
  USER = 'user',
  ADMIN = 'admin',
  SELLER = 'seller',
}

export class RegisterDto {
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

  @ApiProperty({
    description: 'Primeiro nome do usuário',
    example: 'Joao',
    minLength: 3,
    maxLength: 12,
  })
  @IsString() //valido a senha é string
  firstName!: string;

  @ApiProperty({
    description: 'Sobrenome do usuário',
    example: 'Passos',
    minLength: 2,
    maxLength: 12,
  })
  @IsString() //valido a senha é string
  lastName!: string;

  @ApiProperty({
    description: 'Role do usuario',
    example: 'user',
    enum: ['user', 'admin', 'seller'],
    required: false,
  })
  @IsOptional() // a role é opcional, todas as contas são criadas como default cliente, depois ela é alterada para, exemplo, vendedor
  @IsString() //valido a senha é string
  role?: Role = Role.USER;
}
