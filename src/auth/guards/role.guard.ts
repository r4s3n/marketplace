import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    // busca no metadados com a chave roles os dados de roles no header
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(), // metodo da rota
      context.getClass(), // classe do controller
    ]);

    if (!requiredRoles) {
      return true;
    }

    // pego as informações do usuario que foi injetada pelo guard de session
    const user = context.switchToHttp().getRequest().user;

    // teste se ele existe
    if (!user || !user.role) {
      throw new ForbiddenException('User role not authorized');
    }

    // vejo se a role do usuario está dentro da role permitida da rota
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`, // retornamos as roles permitida separada por ,
      );
    }
    return true; // se for permitido, usuario tem acesso aos dados daquela rota
  }
}
