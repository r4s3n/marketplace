import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const originalSecret = process.env.JWT_SECRET;
  let strategy: JwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    strategy = new JwtStrategy();
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('mapeia o payload do users-service (sub) para { userId, email, role }', () => {
    const user = strategy.validate({
      sub: 'user-id',
      email: 'maria@example.com',
      role: 'seller',
      iat: 1,
      exp: 2,
    });

    expect(user).toEqual({
      userId: 'user-id',
      email: 'maria@example.com',
      role: 'seller',
    });
  });

  it('rejeita payload sem sub', () => {
    expect(() =>
      strategy.validate({ email: 'x@example.com', role: 'buyer' } as never),
    ).toThrow(UnauthorizedException);
  });

  it('não sobe sem JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => new JwtStrategy()).toThrow('JWT_SECRET is not defined');
    process.env.JWT_SECRET = 'test-secret';
  });
});
