import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { CustomThrottlerGuard } from './throttler.guard';

@Controller()
class TestController {
  @Get('open')
  open() {
    return { ok: true };
  }

  // sobrescreve apenas o perfil short, como no login do gateway
  @Throttle({ short: { limit: 2, ttl: 60000 } })
  @Get('strict')
  strict() {
    return { ok: true };
  }
}

describe('CustomThrottlerGuard', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'short', ttl: 60000, limit: 3 },
          { name: 'medium', ttl: 60000, limit: 100 },
        ]),
      ],
      controllers: [TestController],
      providers: [{ provide: APP_GUARD, useClass: CustomThrottlerGuard }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const hit = (path: string, ua = 'agent-a') =>
    request(app.getHttpServer()).get(path).set('User-Agent', ua);

  it('bloqueia com 429 ao exceder o limite do perfil', async () => {
    for (let i = 0; i < 3; i++) await hit('/open').expect(200);
    const res = await hit('/open').expect(429);
    expect(Number(res.headers['retry-after-short'])).toBeGreaterThan(0);
  });

  it('expõe headers numéricos por perfil', async () => {
    const res = await hit('/open').expect(200);
    expect(res.headers['x-ratelimit-limit-short']).toBe('3');
    expect(res.headers['x-ratelimit-remaining-short']).toBe('2');
    expect(res.headers['x-ratelimit-limit-medium']).toBe('100');
    expect(res.headers['x-ratelimit-remaining-medium']).toBe('99');
  });

  it('cada perfil conta uma vez por requisição (chaves separadas)', async () => {
    await hit('/open');
    const res = await hit('/open').expect(200);
    expect(res.headers['x-ratelimit-remaining-short']).toBe('1');
    expect(res.headers['x-ratelimit-remaining-medium']).toBe('98');
  });

  it('respeita o @Throttle() da rota', async () => {
    await hit('/strict').expect(200);
    await hit('/strict').expect(200);
    await hit('/strict').expect(429);
  });

  it('rastreia por IP + user-agent', async () => {
    for (let i = 0; i < 3; i++) await hit('/open', 'agent-a').expect(200);
    await hit('/open', 'agent-a').expect(429);
    await hit('/open', 'agent-b').expect(200);
  });
});
