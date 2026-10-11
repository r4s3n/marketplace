import { UserRole } from '../../users/enums/user-role.enum';

// identidade devolvida por GET /auth/validate-token (consumida pelo api-gateway)
export interface ValidatedToken {
  userId: string;
  email: string;
  role: UserRole;
}
