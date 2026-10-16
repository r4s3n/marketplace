import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';

// requisição de rota protegida: o guard global preenche req.user
export type AuthenticatedRequest = Request & { user: AuthenticatedUser };
