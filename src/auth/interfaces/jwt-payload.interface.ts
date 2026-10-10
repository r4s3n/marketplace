import { UserRole } from '../../users/enums/user-role.enum';

// dados do usuário carregados no token (iat/exp são adicionados na assinatura)
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
