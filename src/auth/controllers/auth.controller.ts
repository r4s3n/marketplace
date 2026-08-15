import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../service/auth.service';

@ApiTags('Authentication') // documentação swagger
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK) // Se a requisição tiver sucesso, retorna um status OK
  @ApiOperation({ summary: 'User login' }) // documentação swagger
  @ApiResponse({ status: 200, description: 'Login successful' }) // documentação response swagger para test
  @ApiResponse({ status: 401, description: 'Invalid credentials' }) // documentação response error swagger para test
  async login(@Body() loginDto: { email: string; password: string }) {
    return this.authService.login(loginDto);
  }
  @Post('register')
  @ApiOperation({ summary: 'User registration' }) // documentação swagger
  @ApiResponse({ status: 201, description: 'Registration successful' }) // documentação response swagger para test
  @ApiResponse({ status: 400, description: 'Invalid registration data' }) // documentação response error swagger para test
  async register(@Body() registerDto: any) {
    return this.authService.register(registerDto);
  }
}
