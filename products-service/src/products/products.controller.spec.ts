import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import {
  ONLY_SELLERS,
  PRODUCT_NOT_FOUND,
  ProductsService,
} from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  const productsService = {
    create: jest.fn<ProductsService['create']>(),
    findAll: jest.fn<ProductsService['findAll']>(),
    findBySeller: jest.fn<ProductsService['findBySeller']>(),
    findOne: jest.fn<ProductsService['findOne']>(),
  };

  const dto: CreateProductDto = {
    name: 'Teclado mecânico',
    description: 'Teclado mecânico ABNT2 com switches marrons',
    price: 349.9,
    stock: 15,
  };

  const requestFrom = (user: AuthenticatedUser) =>
    ({ user }) as Request & { user: AuthenticatedUser };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: productsService }],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  describe('create', () => {
    it('repassa o corpo e o usuário autenticado ao service', async () => {
      const user: AuthenticatedUser = {
        id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
        email: 'joao@example.com',
        role: UserRole.SELLER,
      };
      const saved = { ...dto, id: '1', sellerId: user.id } as Product;
      productsService.create.mockResolvedValue(saved);

      await expect(controller.create(dto, requestFrom(user))).resolves.toBe(
        saved,
      );
      expect(productsService.create).toHaveBeenCalledWith(dto, user);
    });

    it('propaga o 403 do service', async () => {
      const user: AuthenticatedUser = {
        id: '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        email: 'maria@example.com',
        role: UserRole.BUYER,
      };
      productsService.create.mockRejectedValue(
        new ForbiddenException(ONLY_SELLERS),
      );

      await expect(
        controller.create(dto, requestFrom(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('devolve a lista do service', async () => {
      const list = [{ ...dto, id: '1' }] as Product[];
      productsService.findAll.mockResolvedValue(list);

      await expect(controller.findAll()).resolves.toBe(list);
      expect(productsService.findAll).toHaveBeenCalledWith();
    });
  });

  describe('findBySeller', () => {
    it('repassa o sellerId ao service', async () => {
      const sellerId = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
      const list = [{ ...dto, id: '1', sellerId }] as Product[];
      productsService.findBySeller.mockResolvedValue(list);

      await expect(controller.findBySeller(sellerId)).resolves.toBe(list);
      expect(productsService.findBySeller).toHaveBeenCalledWith(sellerId);
    });
  });

  describe('findOne', () => {
    const id = '9b2e4c1a-7f3d-4e8b-a6c5-1d2f3e4a5b6c';

    it('repassa o id ao service', async () => {
      const product = { ...dto, id } as Product;
      productsService.findOne.mockResolvedValue(product);

      await expect(controller.findOne(id)).resolves.toBe(product);
      expect(productsService.findOne).toHaveBeenCalledWith(id);
    });

    it('propaga o 404 do service', async () => {
      productsService.findOne.mockRejectedValue(
        new NotFoundException(PRODUCT_NOT_FOUND),
      );

      await expect(controller.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
