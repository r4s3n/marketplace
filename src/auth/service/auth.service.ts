import { HttpService } from '@nestjs/axios';
import {
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { serviceConfig } from '../../config/gateway.config';
import { RegisterDto } from '../dtos/register.dto';
import { LoginDto } from '../dtos/login.dto';

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

// usuário público retornado pelo users-service (nunca contém a senha)
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// contrato do POST /auth/login do users-service
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly httpService: HttpService,
  ) {}

  // valida o token que é enviado
  validateJwtToken(token: string): Promise<AuthResponse> {
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
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<AuthResponse>(
          `${serviceConfig.users.url}/auth/login`,
          loginDto,
          { timeout: serviceConfig.users.timeout },
        ),
      );
      return data;
    } catch (error) {
      this.handleUsersServiceError(error);
    }
  }

  // faz o registro na aplicação
  async register(registerDto: RegisterDto): Promise<PublicUser> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<PublicUser>(
          `${serviceConfig.users.url}/auth/register`,
          registerDto,
          { timeout: serviceConfig.users.timeout },
        ),
      );
      return data;
    } catch (error) {
      this.handleUsersServiceError(error);
    }
  }

  // repassa o erro de negócio do users-service (400, 401, 409...) com o mesmo status e corpo;
  // falhas de rede viram 503/504 sem expor URL ou stack
  private handleUsersServiceError(error: unknown): never {
    if (isAxiosError(error)) {
      if (error.response) {
        throw new HttpException(
          error.response.data as Record<string, unknown>,
          error.response.status,
        );
      }
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new GatewayTimeoutException('Users service timeout');
      }
    }
    throw new ServiceUnavailableException('Users service unavailable');
  }
}
