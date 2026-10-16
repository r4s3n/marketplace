import { UserRole } from '../enums/user-role.enum';

// payload emitido pelo users-service no login (iat/exp são adicionados na assinatura)
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
