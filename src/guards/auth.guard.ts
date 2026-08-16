import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

// lidando com o erro AuthGuard, para o typeScript conseguir inferir o tipo da classe e consigo extender ela
// const JwtGuard: Type<IAuthGuard>
const JwtGuard = AuthGuard('jwt');

@Injectable()
export class JwtAuthGuard extends JwtGuard {
  // o reflector lê metadados anexados a rotas (headers)
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(
    // qual a rota que ele está inserido
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // verificamos se a rota é publica
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(), // pegamos qual o método que está sendo executado
      context.getClass(), // pegamos qual a class que está sendo chamada
    ]);
    // se a rota for publica, não precisa passar pelo meu guardian
    if (isPublic) {
      return true;
    }
    // se não for publica, retornamos o nosso contexto para o classe pai AuthGuard
    return super.canActivate(context);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    return user;
  }
}
