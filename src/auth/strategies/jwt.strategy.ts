import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AuthService } from '../service/auth.service';
import { Strategy, ExtractJwt } from 'passport-jwt';

interface payload {
  sub: string;
  email: string;
  role: string;
  token: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    // instalamos o types do passport-jwt para desenvolvimento, então tive que mudar o processo a baixo
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // pegamos o token do header
      ignoreExpiration: false, // ignoramos a expiração
      secretOrKey: jwtSecret, // e pegamos o nosso JWT_Secret do .env
    });
  }

  // vamos validar esse payload
  async validate(payload: payload) {
    if (!payload) {
      throw new UnauthorizedException();
    }
    const user = await this.authService.validateJwtToken(payload.token);
    if (!user) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
