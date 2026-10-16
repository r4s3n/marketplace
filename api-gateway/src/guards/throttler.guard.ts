import { Injectable } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerRequest,
} from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  // rastreamos por IP + user-agent
  protected getTracker(req: Record<string, string>): Promise<string> {
    return Promise.resolve(`${req.ip}-${req.headers['user-agent']}`);
  }

  // chamado uma vez para cada perfil configurado (short, medium, long)
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    // limit e ttl já vêm resolvidos pela lib, considerando o @Throttle() da rota
    const { context, limit, ttl, throttler, blockDuration } = requestProps;
    const { req, res } = this.getRequestResponse(context);
    const throttlerName = throttler.name ?? 'default'; // cada perfil tem sua própria chave/contagem
    const tracker = await this.getTracker(req);
    const key = this.generateKey(context, tracker, throttlerName);

    // o storage devolve o registro da chave, não apenas o número de hits
    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storageService.increment(
        key, // chave de rastreamento que criamos acima
        ttl, // time to live
        limit, // o limit de requisições
        blockDuration, // por quanto tempo fica bloqueado ao estourar o limite
        throttlerName, // nome do perfil
      );

    const suffix = throttlerName === 'default' ? '' : `-${throttlerName}`; // um header por perfil

    if (isBlocked) {
      res.setHeader(`Retry-After${suffix}`, timeToBlockExpire); // em segundos
      throw new ThrottlerException();
    }

    res.setHeader(`${this.headerPrefix}-Limit${suffix}`, limit); // limite de requisições
    res.setHeader(
      `${this.headerPrefix}-Remaining${suffix}`,
      Math.max(0, limit - totalHits),
    ); // numero restante de requisições
    res.setHeader(`${this.headerPrefix}-Reset${suffix}`, timeToExpire); // segundos até a contagem ser resetada
    return true;
  }
}
