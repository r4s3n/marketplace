import { beforeEach, describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('retorna status ok e o nome do serviço', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'products-service',
    });
  });

  it('é uma rota pública', () => {
    const isPublic = new Reflector().get<boolean>(
      IS_PUBLIC_KEY,
      HealthController,
    );
    expect(isPublic).toBe(true);
  });
});
