import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { compare, hash } from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
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

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'maria@example.com',
      password: 'senha123',
    };
    let storedUser: User;
    let signAsync: jest.Spied<JwtService['signAsync']>;

    const invalidCredentials = new UnauthorizedException(
      'Credenciais inválidas',
    );

    beforeAll(async () => {
      storedUser = {
        id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
        email: loginDto.email,
        password: await hash(loginDto.password, 10),
        firstName: 'Maria',
        lastName: 'Silva',
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    beforeEach(() => {
      signAsync = jest.spyOn(jwtService, 'signAsync');
    });

    afterEach(() => {
      signAsync.mockRestore();
    });

    it('retorna o usuário sem password e um token', async () => {
      usersService.findByEmail.mockResolvedValue(storedUser);

      const result = await service.login(loginDto);

      expect(Object.keys(result).sort()).toEqual(['token', 'user']);
      expect(Object.keys(result.user).sort()).toEqual(
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
      expect(result.user).not.toHaveProperty('password');
      expect(typeof result.token).toBe('string');
      expect(usersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
    });

    it('gera token com sub, email e role e validade de 24h', async () => {
      usersService.findByEmail.mockResolvedValue(storedUser);

      const { token } = await service.login(loginDto);
      const payload = jwtService.verify<
        JwtPayload & { iat: number; exp: number }
      >(token);

      expect(Object.keys(payload).sort()).toEqual(
        ['sub', 'email', 'role', 'iat', 'exp'].sort(),
      );
      expect(payload).toMatchObject({
        sub: storedUser.id,
        email: storedUser.email,
        role: storedUser.role,
      });
      expect(payload.exp - payload.iat).toBe(86400);
    });

    it('gera token inválido para outro segredo', async () => {
      usersService.findByEmail.mockResolvedValue(storedUser);

      const { token } = await service.login(loginDto);

      expect(() => {
        jwtService.verify(token, { secret: 'outro-segredo' });
      }).toThrow();
    });

    it('lança 401 quando o e-mail não está cadastrado', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(invalidCredentials);
      expect(signAsync).not.toHaveBeenCalled();
    });

    it('lança 401 quando a senha está errada, com a mesma resposta do e-mail inexistente', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const unknownEmail = await service
        .login(loginDto)
        .catch((e: UnauthorizedException) => e);

      usersService.findByEmail.mockResolvedValue(storedUser);
      const wrongPassword = await service
        .login({ ...loginDto, password: 'outra-senha' })
        .catch((e: UnauthorizedException) => e);

      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword).toEqual(invalidCredentials);
      expect((wrongPassword as UnauthorizedException).getResponse()).toEqual(
        (unknownEmail as UnauthorizedException).getResponse(),
      );
      expect(signAsync).not.toHaveBeenCalled();
    });

    it('lança 401 "Conta inativa" para conta inativa com senha correta', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...storedUser,
        status: UserStatus.INACTIVE,
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Conta inativa'),
      );
      expect(signAsync).not.toHaveBeenCalled();
    });

    it('lança 401 "Credenciais inválidas" para conta inativa com senha errada', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...storedUser,
        status: UserStatus.INACTIVE,
      });

      await expect(
        service.login({ ...loginDto, password: 'outra-senha' }),
      ).rejects.toThrow(invalidCredentials);
      expect(signAsync).not.toHaveBeenCalled();
    });
  });
});
