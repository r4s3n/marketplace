import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom } from 'rxjs';
import { serviceConfig } from '../../config/gateway.config';

export interface UserSession {
  valid: boolean;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
  } | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly httpService: HttpService,
  ) {}

  // valida o token que é enviado
  validateJwtToken(token: string): Promise<any> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException(`Invalid JWT token ${error}`);
    }
  }

  // valida se o token ainda está ativo
  async validateSessionToken(sessionToken: string): Promise<UserSession> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<UserSession>(
          `${serviceConfig.users.url}/session/validate/${sessionToken}`,
          { timeout: serviceConfig.users.timeout },
        ),
      );
      return data;
    } catch (error) {
      throw new UnauthorizedException(`Invalid session token ${error}`);
    }
  }

  // faz o login
  async login(loginDto: { email: string; password: string }) {
    try {
      const data = await firstValueFrom(
        this.httpService.post(`${serviceConfig.users.url}/login`, loginDto, {
          timeout: serviceConfig.users.timeout,
        }),
      );
      return data;
    } catch (error) {
      throw new UnauthorizedException(`Invalid login credentials ${error}`);
    }
  }

  // faz o registro na aplicação
  async register(registerDto: any) {
    try {
      const data = await firstValueFrom(
        this.httpService.post(
          `${serviceConfig.users.url}/auth/register`,
          registerDto,
          {
            timeout: serviceConfig.users.timeout,
          },
        ),
      );
      return data;
    } catch (error) {
      throw new UnauthorizedException(`register invalid ${error}`);
    }
  }
}
