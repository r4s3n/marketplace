import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../users/enums/user-status.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const SALT_ROUNDS = 10;
const UNIQUE_VIOLATION = '23505'; // código do PostgreSQL para violação de unicidade
const INVALID_CREDENTIALS = 'Credenciais inválidas';
// comparado quando o e-mail não existe, para igualar o tempo de resposta
const DUMMY_HASH = hashSync('dummy-password', SALT_ROUNDS);

export type PublicUser = Omit<User, 'password'>;

export type LoginResponse = { user: PublicUser; token: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    const passwordHash = await hash(dto.password, SALT_ROUNDS);

    let created: User;
    try {
      created = await this.usersService.create({
        ...dto,
        password: passwordHash,
        status: UserStatus.ACTIVE,
      });
    } catch (error) {
      // cadastro simultâneo: a verificação prévia passou, mas o banco recusou
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email já cadastrado');
      }
      throw error;
    }

    return this.toPublicUser(created);
  }

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      await compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // só depois das credenciais, para não revelar a conta a terceiros
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Conta inativa');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const token = await this.jwtService.signAsync(payload);

    return { user: this.toPublicUser(user), token };
  }

  private toPublicUser(user: User): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...publicUser } = user;
    return publicUser;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
    );
  }
}
