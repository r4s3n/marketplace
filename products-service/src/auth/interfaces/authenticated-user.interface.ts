import { UserRole } from '../enums/user-role.enum';

// usuário autenticado disponível em req.user nas rotas protegidas
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}
