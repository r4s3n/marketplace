import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) sem token retorna 401', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  // login e registro ficam no users-service
  it('não expõe rotas de autenticação', async () => {
    await request(app.getHttpServer()).post('/auth/login').expect(404);
    await request(app.getHttpServer()).post('/auth/register').expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
