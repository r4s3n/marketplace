import { createParamDecorator, ExecutionContext } from '@nestjs/common';
// extraio informações do objeto da requisição
export const CurrentUser = createParamDecorator(
  // pego o request do context e retorno o usuario da sessão
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return request.user;
  },
);
