import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { segment } from '../common/utils/path-segment';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

// schemas só para documentação: o corpo segue intacto e quem valida é o users-service
const registerSchema = {
  type: 'object',
  required: ['email', 'password', 'firstName', 'lastName', 'role'],
  properties: {
    email: { type: 'string', format: 'email', example: 'maria@example.com' },
    password: { type: 'string', minLength: 6, example: 'senha123' },
    firstName: { type: 'string', maxLength: 100, example: 'Maria' },
    lastName: { type: 'string', maxLength: 100, example: 'Silva' },
    role: { type: 'string', enum: ['seller', 'buyer'], example: 'seller' },
  },
};

const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', example: 'maria@example.com' },
    password: { type: 'string', minLength: 6, example: 'senha123' },
  },
};

// todas as rotas do users-service passam pelo ProxyService (circuit breaker, retry, timeout, fallback)
// sem prefixo: o controller atende /auth e /users, e o guard é aplicado por rota
@Controller()
export class UsersController {
  constructor(private readonly proxyService: ProxyService) {}

  // repassa o Authorization original: o users-service também valida o token
  private forward(path: string, authorization: string, user: JwtUser) {
    return this.proxyService.proxyRequest(
      'users',
      'get',
      path,
      undefined,
      { authorization },
      user,
    );
  }

  @Post('auth/register')
  @ApiTags('Authentication')
  @ApiOperation({ summary: 'Registra um novo usuário' })
  @ApiBody({ schema: registerSchema })
  @ApiResponse({ status: 201, description: 'Usuário criado (sem senha)' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  @Throttle({ medium: { limit: 3, ttl: 60000 } })
  register(
    // Record (metatype Object): o ValidationPipe global não valida nem remove campos
    @Body() body: Record<string, unknown>,
  ) {
    return this.proxyService.proxyRequest(
      'users',
      'post',
      '/auth/register',
      body,
    );
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK) // login não cria recurso
  @ApiTags('Authentication')
  @ApiOperation({ summary: 'Autentica o usuário e retorna o JWT' })
  @ApiBody({ schema: loginSchema })
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
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  login(@Body() body: Record<string, unknown>) {
    return this.proxyService.proxyRequest('users', 'post', '/auth/login', body);
  }

  @Get('auth/validate-token')
  @UseGuards(JwtAuthGuard) // o gateway valida o JWT antes de chamar o users-service
  @ApiTags('Authentication')
  @ApiBearerAuth('JWT-auth')
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
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  validateToken(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('/auth/validate-token', authorization, user);
  }

  // rotas estáticas (profile, sellers) declaradas antes da dinâmica (:id)

  @Get('users/profile')
  @UseGuards(JwtAuthGuard)
  @ApiTags('Users')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Usuário logado' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  profile(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('/users/profile', authorization, user);
  }

  @Get('users/sellers')
  @UseGuards(JwtAuthGuard)
  @ApiTags('Users')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Lista os vendedores ativos' })
  @ApiResponse({ status: 200, description: 'Array de vendedores ativos' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  sellers(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('/users/sellers', authorization, user);
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard)
  @ApiTags('Users')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Busca um usuário pelo ID' })
  @ApiResponse({ status: 200, description: 'Usuário encontrado' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  @ApiResponse({ status: 503, description: 'users-service indisponível' })
  findById(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward(`/users/${segment(id)}`, authorization, user);
  }
}
