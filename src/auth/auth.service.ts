import { ConflictException, Injectable } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../users/enums/user-status.enum';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 10;
const UNIQUE_VIOLATION = '23505'; // código do PostgreSQL para violação de unicidade

export type PublicUser = Omit<User, 'password'>;

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...user } = created;
    return user;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
    );
  }
}
