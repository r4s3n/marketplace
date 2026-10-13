import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ONLY_SELLERS, ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  const productsService = {
    create: jest.fn<ProductsService['create']>(),
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
});
