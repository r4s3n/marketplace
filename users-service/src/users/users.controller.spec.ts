import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = {
    findById: jest.fn<UsersService['findById']>(),
    findActiveSellers: jest.fn<UsersService['findActiveSellers']>(),
  };

  const buildUser = (overrides: Partial<User> = {}): User => ({
    id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'maria@example.com',
    password: 'hash',
    firstName: 'Maria',
    lastName: 'Silva',
    role: UserRole.BUYER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const requestFrom = (user: User) =>
    ({
      user: { id: user.id, email: user.email, role: user.role },
    }) as Request & { user: AuthenticatedUser };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('profile', () => {
    it('busca o usuário do token no banco e retorna sem password', async () => {
      const user = buildUser();
      usersService.findById.mockResolvedValue(user);

      const result = await controller.profile(requestFrom(user));

      expect(usersService.findById).toHaveBeenCalledWith(user.id);
      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: user.id, email: user.email });
    });

    it('lança 401 quando o usuário do token não existe mais', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        controller.profile(requestFrom(buildUser())),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('sellers', () => {
    it('retorna os sellers ativos sem password', async () => {
      usersService.findActiveSellers.mockResolvedValue([
        buildUser({ id: 'a', role: UserRole.SELLER }),
        buildUser({ id: 'b', role: UserRole.SELLER }),
      ]);

      const result = await controller.sellers();

      expect(result).toHaveLength(2);
      for (const seller of result) {
        expect(seller).not.toHaveProperty('password');
      }
    });

    it('retorna array vazio quando não há sellers ativos', async () => {
      usersService.findActiveSellers.mockResolvedValue([]);

      await expect(controller.sellers()).resolves.toStrictEqual([]);
    });
  });

  describe('findById', () => {
    it('retorna o usuário sem password', async () => {
      const user = buildUser();
      usersService.findById.mockResolvedValue(user);

      const result = await controller.findById(user.id);

      expect(usersService.findById).toHaveBeenCalledWith(user.id);
      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: user.id });
    });

    it('lança 404 quando o usuário não existe', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        controller.findById('3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c91'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
