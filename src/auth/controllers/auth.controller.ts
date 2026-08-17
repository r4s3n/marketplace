import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../service/auth.service';
import { Throttle } from '@nestjs/throttler';
import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';

@ApiTags('Authentication') // documentação swagger
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK) // Se a requisição tiver sucesso, retorna um status OK
  @ApiOperation({
    summary: 'User login',
    description: 'Autentica um usuário e retorna JWT token e session token',
  }) // documentação swagger
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    // informo o schema de retorno do login
    schema: {
      type: 'object',
      properties: {
        user: { type: 'object' },
        accessToken: { type: 'string' },
        sessionToken: { type: 'string' },
        expiresIn: { type: 'number' },
      },
    },
  }) // documentação response swagger para test
  @ApiResponse({ status: 401, description: 'Invalid credentials' }) // documentação response error swagger para test
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
  @Post('register')
  @ApiOperation({
    summary: 'User registration',
    description: 'Cria uma nova conta de usuárioo no sistema',
  }) // documentação swagger
  @ApiResponse({ status: 201, description: 'Uauário registrado com sucesso!' }) // documentação response swagger para test
  @ApiResponse({ status: 400, description: 'Dados inválidos' }) // documentação response error swagger para test
  @ApiResponse({ status: 409, description: 'Email já registrado' }) // documentação response error swagger para test
  @Throttle({ medium: { limit: 3, ttl: 60000 } })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
}
