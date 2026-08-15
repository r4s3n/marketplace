import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AuthService } from '../service/auth.service';
import { Strategy, ExtractJwt } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // pegamos o token do header
      ignoreExpiration: false, // ignoramos a expiração
      secretOrKey: process.env.JWT_SECRET, // e pegamos o nosso JWT_Secret do .env
    });
  }

  // vamos validar esse payload
  async validate(payload: any) {
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
