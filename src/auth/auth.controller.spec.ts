import { beforeEach, describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { UserRole } from '../users/enums/user-role.enum';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: {} }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('validateToken', () => {
    const user: AuthenticatedUser = {
      id: 'b3b1c7a2-1f0e-4c1a-9d2e-0a1b2c3d4e5f',
      email: 'maria@example.com',
      role: UserRole.SELLER,
    };
    const req = { user } as Request & { user: AuthenticatedUser };

    it('retorna userId, email e role do usuário autenticado', () => {
      expect(controller.validateToken(req)).toEqual({
        userId: user.id,
        email: user.email,
        role: user.role,
      });
    });

    it('não expõe campos além de userId, email e role', () => {
      expect(Object.keys(controller.validateToken(req)).sort()).toEqual([
        'email',
        'role',
        'userId',
      ]);
    });

    it('não é uma rota pública', () => {
      const reflector = new Reflector();
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'validateToken',
      )?.value as () => unknown;
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, AuthController)).toBeUndefined();
    });
  });
});
