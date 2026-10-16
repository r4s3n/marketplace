import { HttpService } from '@nestjs/axios';
import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import {
  PRODUCT_NOT_FOUND,
  PRODUCTS_SERVICE_UNAVAILABLE,
  ProductsClientService,
} from './products-client.service';

const productId = 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f';

// resposta do products-service, com os campos que o carrinho não usa
const productBody = {
  id: productId,
  name: 'Teclado mecânico',
  description: 'Teclado mecânico ABNT2',
  price: '349.90',
  stock: 15,
  sellerId: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
  isActive: true,
  createdAt: '2026-10-14T20:00:00.000Z',
  updatedAt: '2026-10-14T20:00:00.000Z',
};

const ok = (data: unknown) => of({ data, status: 200 } as AxiosResponse);

const axiosError = (code: string, status?: number) =>
  new AxiosError(
    'falha',
    code,
    undefined,
    undefined,
    status === undefined
      ? undefined
      : ({
          status,
          data: {},
          headers: {},
          statusText: '',
          config: { headers: new AxiosHeaders() },
        } as AxiosResponse),
  );

describe('ProductsClientService', () => {
  let service: ProductsClientService;
  const http = { get: jest.fn() };
  let logError: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetAllMocks();
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsClientService,
        { provide: HttpService, useValue: http },
      ],
    }).compile();

    service = module.get(ProductsClientService);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('busca GET /products/:id e devolve só os campos do contrato, com números', async () => {
    http.get.mockReturnValue(ok(productBody));

    await expect(service.getProduct(productId)).resolves.toStrictEqual({
      id: productId,
      name: 'Teclado mecânico',
      price: 349.9,
      stock: 15,
      isActive: true,
      sellerId: productBody.sellerId,
    });
    expect(http.get).toHaveBeenCalledWith(`/products/${productId}`);
  });

  it('não envia header Authorization', async () => {
    http.get.mockReturnValue(ok(productBody));

    await service.getProduct(productId);

    // só a URL: nenhuma configuração de headers é passada
    expect(http.get.mock.calls[0]).toHaveLength(1);
  });

  it('devolve produto inativo sem erro', async () => {
    http.get.mockReturnValue(ok({ ...productBody, isActive: false }));

    await expect(service.getProduct(productId)).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('404 do products-service → NotFoundException', async () => {
    http.get.mockReturnValue(
      throwError(() => axiosError('ERR_BAD_REQUEST', 404)),
    );

    const promise = service.getProduct(productId);
    await expect(promise).rejects.toThrow(NotFoundException);
    await expect(promise).rejects.toThrow(PRODUCT_NOT_FOUND);
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    ['500 do products-service', axiosError('ERR_BAD_RESPONSE', 500)],
    ['400 do products-service', axiosError('ERR_BAD_REQUEST', 400)],
    ['conexão recusada', axiosError('ECONNREFUSED')],
    ['timeout', axiosError('ECONNABORTED')],
    ['erro inesperado', new Error('boom')],
  ])('%s → ServiceUnavailableException e log', async (_, error) => {
    http.get.mockReturnValue(throwError(() => error));

    const promise = service.getProduct(productId);
    await expect(promise).rejects.toThrow(ServiceUnavailableException);
    await expect(promise).rejects.toThrow(PRODUCTS_SERVICE_UNAVAILABLE);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining(productId));
  });
});
