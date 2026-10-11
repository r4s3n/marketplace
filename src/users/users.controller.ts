import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PublicUser, toPublicUser } from './public-user';
import { UsersService } from './users.service';

const USER_NOT_FOUND = 'Usuário não encontrado';

// rotas estáticas (profile, sellers) declaradas antes da dinâmica (:id)
@ApiTags('Users')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Usuário logado (sem senha)' })
  async profile(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<PublicUser> {
    // busca no banco para devolver dados atualizados, não o conteúdo do token
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      // token válido, mas o usuário não existe mais
      throw new UnauthorizedException();
    }
    return toPublicUser(user);
  }

  @Get('sellers')
  @ApiOperation({ summary: 'Lista os vendedores ativos' })
  @ApiResponse({ status: 200, description: 'Array de vendedores ativos' })
  async sellers(): Promise<PublicUser[]> {
    const sellers = await this.usersService.findActiveSellers();
    return sellers.map(toPublicUser);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um usuário pelo ID' })
  @ApiResponse({ status: 200, description: 'Usuário (sem senha)' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  async findById(
    // id fora do formato UUID nunca corresponde a um usuário: 404 sem ir ao banco
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () => new NotFoundException(USER_NOT_FOUND),
      }),
    )
    id: string,
  ): Promise<PublicUser> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return toPublicUser(user);
  }
}
