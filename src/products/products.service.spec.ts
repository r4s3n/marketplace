import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ONLY_SELLERS, ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const repository = {
    create: jest.fn<(data: Partial<Product>) => Product>(),
    save: jest.fn<(product: Product) => Promise<Product>>(),
  };

  const dto: CreateProductDto = {
    name: 'Teclado mecânico',
    description: 'Teclado mecânico ABNT2 com switches marrons',
    price: 349.9,
    stock: 15,
  };
  const seller: AuthenticatedUser = {
    id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'joao@example.com',
    role: UserRole.SELLER,
  };
  const buyer: AuthenticatedUser = {
    id: '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    email: 'maria@example.com',
    role: UserRole.BUYER,
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: repository },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    it('seller cria o produto com sellerId do token e isActive = true', async () => {
      const entity = { ...dto, sellerId: seller.id, isActive: true } as Product;
      const saved = { ...entity, id: '1' };
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(saved);

      await expect(service.create(dto, seller)).resolves.toBe(saved);
      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        sellerId: seller.id,
        isActive: true,
      });
      expect(repository.save).toHaveBeenCalledWith(entity);
    });

    it('buyer recebe 403 e nada é gravado', async () => {
      await expect(service.create(dto, buyer)).rejects.toThrow(
        new ForbiddenException(ONLY_SELLERS),
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('relança erros do banco', async () => {
      const error = new Error('conexão perdida');
      repository.create.mockReturnValue({} as Product);
      repository.save.mockRejectedValue(error);

      await expect(service.create(dto, seller)).rejects.toBe(error);
    });
  });
});
