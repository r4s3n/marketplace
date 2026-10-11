import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PublicUser } from '../users/public-user';
import { AuthService, LoginResponse } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { ValidatedToken } from './interfaces/validated-token.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register') // responde 201 por padrão
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // login não cria recurso
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  // protegida pelo guard global: chegar aqui já significa token válido
  @Get('validate-token')
  validateToken(
    @Req() req: Request & { user: AuthenticatedUser },
  ): ValidatedToken {
    const { id, email, role } = req.user;
    return { userId: id, email, role };
  }
}
