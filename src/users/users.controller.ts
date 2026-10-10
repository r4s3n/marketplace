import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PublicUser, toPublicUser } from './public-user';
import { UsersService } from './users.service';

const USER_NOT_FOUND = 'Usuário não encontrado';

// rotas estáticas (profile, sellers) declaradas antes da dinâmica (:id)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
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
  async sellers(): Promise<PublicUser[]> {
    const sellers = await this.usersService.findActiveSellers();
    return sellers.map(toPublicUser);
  }

  @Get(':id')
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
