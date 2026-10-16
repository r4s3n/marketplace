import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PublicUser } from '../users/public-user';
import { AuthService, LoginResponse } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import type { ValidatedToken } from './interfaces/validated-token.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register') // responde 201 por padrão
  @ApiOperation({ summary: 'Registra um novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário criado (sem senha)' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // login não cria recurso
  @ApiOperation({ summary: 'Autentica o usuário e retorna o JWT' })
  @ApiResponse({
    status: 200,
    description: 'Login realizado',
    schema: {
      type: 'object',
      properties: { user: { type: 'object' }, token: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  // protegida pelo guard global: chegar aqui já significa token válido
  @Get('validate-token')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Valida o JWT e retorna a identidade do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Token válido',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', format: 'uuid' },
        email: { type: 'string' },
        role: { type: 'string', enum: ['seller', 'buyer'] },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  validateToken(
    @Req() req: Request & { user: AuthenticatedUser },
  ): ValidatedToken {
    const { id, email, role } = req.user;
    return { userId: id, email, role };
  }
}
