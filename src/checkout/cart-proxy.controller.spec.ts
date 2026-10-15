import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';
import { CartProxyController } from './cart-proxy.controller';

describe('CartProxyController', () => {
  let controller: CartProxyController;
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
      controllers: [CartProxyController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CartProxyController>(CartProxyController);
  });

  it('POST /cart/items encaminha o corpo intacto, o Authorization e o usuário', async () => {
    // campo extra prova que o gateway não filtra: quem valida é o checkout-service
    const body = { productId: 'product-id', quantity: 2, price: 1 };
    const cart = { id: 'cart-id', items: [] };
    proxyService.proxyRequest.mockResolvedValue(cart);

    await expect(
      controller.addItem(body, authorization, user),
    ).resolves.toEqual(cart);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'post',
      '/cart/items',
      body,
      { authorization },
      user,
    );
    expect(proxyService.proxyRequest.mock.calls[0][3]).toBe(body);
  });

  it('GET /cart encaminha com o Authorization e o usuário', async () => {
    const cart = { id: null, items: [] };
    proxyService.proxyRequest.mockResolvedValue(cart);

    await expect(controller.getCart(authorization, user)).resolves.toEqual(
      cart,
    );
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'get',
      '/cart',
      undefined,
      { authorization },
      user,
    );
  });

  it('DELETE /cart/items/:itemId encaminha com o itemId', async () => {
    const itemId = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
    const cart = { id: 'cart-id', items: [] };
    proxyService.proxyRequest.mockResolvedValue(cart);

    await expect(
      controller.removeItem(itemId, authorization, user),
    ).resolves.toEqual(cart);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'delete',
      `/cart/items/${itemId}`,
      undefined,
      { authorization },
      user,
    );
  });

  it('codifica o itemId como um único segmento', async () => {
    await controller.removeItem('a/b?c', authorization, user);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'checkout',
      'delete',
      '/cart/items/a%2Fb%3Fc',
      undefined,
      { authorization },
      user,
    );
  });

  it.each(['.', '..'])(
    'barra o itemId %p sem chamar o checkout-service',
    (value) => {
      expect(() => controller.removeItem(value, authorization, user)).toThrow(
        BadRequestException,
      );
      expect(proxyService.proxyRequest).not.toHaveBeenCalled();
    },
  );

  it('protege o controller inteiro com o JwtAuthGuard', () => {
    const guards =
      (Reflect.getMetadata('__guards__', CartProxyController) as unknown[]) ??
      [];
    expect(guards).toContain(JwtAuthGuard);
  });
});
