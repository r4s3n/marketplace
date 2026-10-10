import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../users/enums/user-role.enum';

export class RegisterDto {
  @IsNotEmpty({ message: 'email é obrigatório' })
  @IsString({ message: 'email deve ser um texto' })
  @IsEmail({}, { message: 'email deve ser um e-mail válido' })
  email: string;

  @IsNotEmpty({ message: 'password é obrigatório' })
  @IsString({ message: 'password deve ser um texto' })
  @MinLength(6, { message: 'password deve ter no mínimo 6 caracteres' })
  password: string;

  @IsNotEmpty({ message: 'firstName é obrigatório' })
  @IsString({ message: 'firstName deve ser um texto' })
  @MaxLength(100, { message: 'firstName deve ter no máximo 100 caracteres' })
  firstName: string;

  @IsNotEmpty({ message: 'lastName é obrigatório' })
  @IsString({ message: 'lastName deve ser um texto' })
  @MaxLength(100, { message: 'lastName deve ter no máximo 100 caracteres' })
  lastName: string;

  @IsNotEmpty({ message: 'role é obrigatório' })
  @IsEnum(UserRole, { message: 'role deve ser seller ou buyer' })
  role: UserRole;
}
