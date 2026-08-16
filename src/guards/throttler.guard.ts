import { Injectable } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerRequest,
} from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, string>): Promise<string> {
    return Promise.resolve(`${req.ip}-${req.headers['user-agent']}`);
  }

  // vou pegar o context, o limit e o ttl
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, limit, ttl } = requestProps; // pegamos os valores dentro de ThrottlerRequest
    const { req, res } = this.getRequestResponse(context);
    const throttles = this.reflector.get('throttler', context.getHandler()); // pegamos o nome da config de requisição. Ex: 'short'
    const throttlerName = throttles ? Object.keys(throttles)[0] : 'default'; // da lista, pegamos o primeiro valor ou usamos o default
    const tracker = await this.getTracker(req);
    const key = this.generateKey(context, tracker, throttlerName);

    const totalHits = await this.storageService.increment(
      key, //chave de rastreamento que criamos acima
      ttl, // time to live
      limit, // o limit de requisições
      1, // o valor inclementado a cada requisição
      throttlerName, // nome do perfil
    );

    if (Number(totalHits) > limit) {
      res.setHeader('Retry-After', Math.round(ttl / 1000));
      throw new ThrottlerException();
    }

    res.setHeader(`${this.headerPrefix}-Limit`, limit); // limite de requisições
    res.setHeader(`${this.headerPrefix}-Remaining`, limit - Number(totalHits)); // numero restante de requisições
    res.setHeader(`${this.headerPrefix}-Reset`, Math.round(ttl / 1000)); // timestemp é a contagem de quando será resetada a contagem
    return true;
  }
}
