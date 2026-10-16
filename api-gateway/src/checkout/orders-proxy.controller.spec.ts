import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';
import { OrdersProxyController } from './orders-proxy.controller';

describe('OrdersProxyController', () => {
  let controller: OrdersProxyController;
  const proxyService = { proxyRequest: jest.fn() };

  const authorization = 'Bearer jwt-token';
  const user = {
    userId: 'buyer-id',
    email: 'joao@example.com',
    role: 'buyer',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersProxyController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrdersProxyController>(OrdersProxyController);
  });

  it('POST /cart/checkout encaminha o corpo intacto, o Authorization e o usuário', async () => {
    // campo extra prova que o gateway não filtra: quem valida é o checkout-service
    const body = { paymentMethod: 'pix', total: 1 };
    const order = { id: 'order-id', status: 'pending' };
    proxyService.proxyRequest.mockResolvedValue(order);

    await expect(
      controller.checkout(body, authorization, user),
    ).resolves.toEqual(order);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'post',
      '/cart/checkout',
      body,
      { authorization },
      user,
    );
    expect(proxyService.proxyRequest.mock.calls[0][3]).toBe(body);
  });

  it('GET /orders encaminha com o Authorization e o usuário', async () => {
    const orders = [{ id: 'order-id' }];
    proxyService.proxyRequest.mockResolvedValue(orders);

    await expect(controller.findAll(authorization, user)).resolves.toEqual(
      orders,
    );
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'get',
      '/orders',
      undefined,
      { authorization },
      user,
    );
  });

  it('GET /orders/:id encaminha com o id', async () => {
    const id = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
    const order = { id };
    proxyService.proxyRequest.mockResolvedValue(order);

    await expect(controller.findOne(id, authorization, user)).resolves.toEqual(
      order,
    );
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'get',
      `/orders/${id}`,
      undefined,
      { authorization },
      user,
    );
  });

  it('codifica o id como um único segmento', async () => {
    await controller.findOne('a/b?c', authorization, user);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'get',
      '/orders/a%2Fb%3Fc',
      undefined,
      { authorization },
      user,
    );
  });

  it.each(['.', '..'])(
    'barra o id %p sem chamar o checkout-service',
    (value) => {
      expect(() => controller.findOne(value, authorization, user)).toThrow(
        BadRequestException,
      );
      expect(proxyService.proxyRequest).not.toHaveBeenCalled();
    },
  );

  it('protege o controller inteiro com o JwtAuthGuard', () => {
    const guards =
      (Reflect.getMetadata('__guards__', OrdersProxyController) as unknown[]) ??
      [];
    expect(guards).toContain(JwtAuthGuard);
  });
});
