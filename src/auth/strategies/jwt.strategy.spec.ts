import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../users/enums/user-role.enum';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const getOrThrow = jest.fn<(key: string) => string>();
  const config = { getOrThrow } as unknown as ConfigService;

  beforeEach(() => {
    jest.resetAllMocks();
    getOrThrow.mockReturnValue('test-secret');
  });

  it('lê o segredo de JWT_SECRET', () => {
    new JwtStrategy(config);

    expect(getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
  });

  it('falha ao instanciar sem JWT_SECRET', () => {
    getOrThrow.mockImplementation(() => {
      throw new Error('JWT_SECRET ausente');
    });

    expect(() => new JwtStrategy(config)).toThrow();
  });

  it('retorna apenas id, email e role, mapeando sub para id', () => {
    const strategy = new JwtStrategy(config);
    const payload = {
      sub: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
      email: 'maria@example.com',
      role: UserRole.SELLER,
      iat: 1700000000,
      exp: 1700086400,
    } as JwtPayload;

    expect(strategy.validate(payload)).toStrictEqual({
      id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
      email: 'maria@example.com',
      role: UserRole.SELLER,
    });
  });
});
