import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';
import { ProductsController } from './products.controller';

describe('ProductsController', () => {
  let controller: ProductsController;
  const proxyService = { proxyRequest: jest.fn() };

  const authorization = 'Bearer jwt-token';
  const user = {
    userId: 'seller-id',
    email: 'maria@example.com',
    role: 'seller',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  const guardsOf = (target: object) =>
    (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];

  // metadados de guard ficam na função do handler
  const handler = (name: keyof ProductsController) =>
    Object.getOwnPropertyDescriptor(ProductsController.prototype, name)
      ?.value as object;

  it('POST /products encaminha o corpo intacto, o Authorization e o usuário', async () => {
    // campo extra prova que o gateway não filtra: quem valida é o products-service
    const body = { name: 'Teclado', price: 10, stock: 1, sellerId: 'x' };
    const created = { id: 'product-id', ...body };
    proxyService.proxyRequest.mockResolvedValue(created);

    await expect(controller.create(body, authorization, user)).resolves.toEqual(
      created,
    );
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'post',
      '/products',
      body,
      { authorization },
      user,
    );
    expect(proxyService.proxyRequest.mock.calls[0][3]).toBe(body);
  });

  it('GET /products encaminha ao products-service e devolve o array', async () => {
    const products = [{ id: 'product-id' }];
    proxyService.proxyRequest.mockResolvedValue(products);

    await expect(controller.findAll()).resolves.toEqual(products);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'get',
      '/products',
    );
  });

  it('GET /products/seller/:sellerId encaminha com o sellerId', async () => {
    const sellerId = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
    proxyService.proxyRequest.mockResolvedValue([]);

    await expect(controller.findBySeller(sellerId)).resolves.toEqual([]);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'get',
      `/products/seller/${sellerId}`,
    );
  });

  it('GET /products/:id encaminha e devolve o produto', async () => {
    const product = { id: 'product-id' };
    proxyService.proxyRequest.mockResolvedValue(product);

    await expect(controller.findOne('product-id')).resolves.toEqual(product);
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'get',
      '/products/product-id',
    );
  });

  it('codifica o parâmetro como um único segmento', async () => {
    await controller.findOne('a/b?c');
    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'get',
      '/products/a%2Fb%3Fc',
    );
  });

  it.each(['.', '..'])(
    'barra o parâmetro %p sem chamar o products-service',
    (value) => {
      expect(() => controller.findOne(value)).toThrow(BadRequestException);
      expect(() => controller.findBySeller(value)).toThrow(BadRequestException);
      expect(proxyService.proxyRequest).not.toHaveBeenCalled();
    },
  );

  it('protege apenas o POST com o JwtAuthGuard', () => {
    expect(guardsOf(handler('create'))).toContain(JwtAuthGuard);
    expect(guardsOf(ProductsController)).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('findAll'))).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('findBySeller'))).not.toContain(JwtAuthGuard);
    expect(guardsOf(handler('findOne'))).not.toContain(JwtAuthGuard);
  });
});
