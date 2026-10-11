import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@UseGuards(JwtAuthGuard) // o gateway valida o JWT antes de chamar o users-service
@Controller('users')
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

  // rotas estáticas (profile, sellers) declaradas antes da dinâmica (:id)
  @Get('profile')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Usuário logado' })
  profile(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('/users/profile', authorization, user);
  }

  @Get('sellers')
  @ApiOperation({ summary: 'Lista os vendedores ativos' })
  @ApiResponse({ status: 200, description: 'Array de vendedores ativos' })
  sellers(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward('/users/sellers', authorization, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um usuário pelo ID' })
  @ApiResponse({ status: 200, description: 'Usuário encontrado' })
  findById(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.forward(
      `/users/${encodeURIComponent(id)}`,
      authorization,
      user,
    );
  }
}
