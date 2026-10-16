import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

// payload emitido pelo users-service no login
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface JwtUser {
  userId: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    // instalamos o types do passport-jwt para desenvolvimento, então tive que mudar o processo a baixo
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // pegamos o token do header
      ignoreExpiration: false, // rejeitamos tokens expirados
      secretOrKey: jwtSecret, // mesmo JWT_SECRET do users-service
    });
  }

  // assinatura e expiração já foram verificadas pelo passport: só mapeamos o payload
  validate(payload: JwtPayload): JwtUser {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
