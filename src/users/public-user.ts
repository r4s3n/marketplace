import { User } from './entities/user.entity';

// representação do usuário exposta nas respostas: nunca inclui a senha
export type PublicUser = Omit<User, 'password'>;

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...publicUser } = user;
  return publicUser;
}
