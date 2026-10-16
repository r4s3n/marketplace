import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

// handlers com `this: void` para poderem ser passados soltos ao contexto
@Public()
class PublicController {
  route(this: void) {}
}

class MixedController {
  @Public()
  open(this: void) {}

  closed(this: void) {}
}

const contextFor = (
  controller: new () => object,
  handler: () => void,
): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  // canActivate do AuthGuard('jwt'), que valida o token via JwtStrategy
  let passportCanActivate: jest.Spied<JwtAuthGuard['canActivate']>;

  beforeEach(() => {
    guard = new JwtAuthGuard(new Reflector());
    passportCanActivate = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as JwtAuthGuard,
        'canActivate',
      )
      .mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('libera rota marcada com @Public() sem validar token', () => {
    const context = contextFor(MixedController, MixedController.prototype.open);

    expect(guard.canActivate(context)).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('libera todas as rotas de controller marcado com @Public()', () => {
    const context = contextFor(
      PublicController,
      PublicController.prototype.route,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('delega ao Passport a validação de rota sem @Public()', () => {
    const context = contextFor(
      MixedController,
      MixedController.prototype.closed,
    );

    void guard.canActivate(context);

    expect(passportCanActivate).toHaveBeenCalledWith(context);
  });
});
