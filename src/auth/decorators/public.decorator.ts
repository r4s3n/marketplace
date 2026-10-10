import { SetMetadata } from '@nestjs/common';

// chave lida pelo JwtAuthGuard para liberar a rota sem token
export const IS_PUBLIC_KEY = 'isPublic';

// aplicável em um método (uma rota) ou em um controller (todas as rotas)
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
