import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { compare } from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { CreateUserData, UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';

const JWT_SECRET = 'test-secret';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    findByEmail: jest.fn<UsersService['findByEmail']>(),
    create: jest.fn<UsersService['create']>(),
  };
  const jwtService = new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: 86400 },
  });

  const dto: RegisterDto = {
    email: 'maria@example.com',
    password: 'senha123',
    firstName: 'Maria',
    lastName: 'Silva',
    role: UserRole.BUYER,
  };

  const persist = (data: CreateUserData): Promise<User> =>
    Promise.resolve({
      ...data,
      id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  const uniqueViolation = () =>
    new QueryFailedError('INSERT INTO users', [], {
      code: '23505',
    } as unknown as Error);

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('cria o usuário ativo e retorna sem password', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(persist);

      const result = await service.register(dto);

      expect(Object.keys(result).sort()).toEqual(
        [
          'id',
          'email',
          'firstName',
          'lastName',
          'role',
          'status',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(result).toMatchObject({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        status: UserStatus.ACTIVE,
      });
      expect(result).not.toHaveProperty('password');
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: UserStatus.ACTIVE }),
      );
    });

    it('grava a senha como hash bcrypt com custo 10', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(persist);

      await service.register(dto);

      const [{ password }] = usersService.create.mock.calls[0];
      expect(password).not.toBe(dto.password);
      expect(password).toMatch(/^\$2[ab]\$10\$/);
      await expect(compare(dto.password, password)).resolves.toBe(true);
    });

    it('lança 409 quando o e-mail já está cadastrado', async () => {
      usersService.findByEmail.mockResolvedValue({ id: '1' } as User);

      await expect(service.register(dto)).rejects.toThrow(
        new ConflictException('Email já cadastrado'),
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('lança 409 quando o banco recusa por e-mail duplicado (cadastro simultâneo)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(uniqueViolation());

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('relança outros erros do banco', async () => {
      const error = new Error('conexão perdida');
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
    });
  });
});
