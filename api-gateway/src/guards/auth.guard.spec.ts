import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from './auth.guard';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const guard = new JwtAuthGuard(reflector);
  const handler = () => undefined;
  class TestController {}

  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;

  // canActivate da classe pai (AuthGuard('jwt') do passport)
  const parentCanActivate = () =>
    jest.spyOn(
      Object.getPrototypeOf(JwtAuthGuard.prototype) as {
        canActivate: () => boolean;
      },
      'canActivate',
    );

  afterEach(() => jest.restoreAllMocks());

  it('rota marcada como pública passa sem validar o token', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const parent = parentCanActivate();

    expect(guard.canActivate(context)).toBe(true);
    expect(parent).not.toHaveBeenCalled();
  });

  it('procura a metadata isPublic no handler e na classe', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [handler, TestController]);
  });

  it('rota protegida delega a validação ao passport (estratégia jwt)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const parent = parentCanActivate().mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(parent).toHaveBeenCalledWith(context);
  });

  describe('handleRequest', () => {
    const user = {
      userId: 'user-id',
      email: 'maria@example.com',
      role: 'seller',
    };

    it('devolve o usuário autenticado', () => {
      expect(guard.handleRequest(null, user, undefined, context)).toBe(user);
    });

    it('sem usuário → 401', () => {
      expect(() =>
        guard.handleRequest(null, false, undefined, context),
      ).toThrow(UnauthorizedException);
    });

    it('repassa o erro da estratégia', () => {
      const error = new UnauthorizedException('token expirado');
      expect(() =>
        guard.handleRequest(error, false, undefined, context),
      ).toThrow(error);
    });
  });
});
