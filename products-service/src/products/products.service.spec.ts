import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import {
  ONLY_SELLERS,
  PRODUCT_NOT_FOUND,
  ProductsService,
} from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const repository = {
    create: jest.fn<(data: Partial<Product>) => Product>(),
    save: jest.fn<(product: Product) => Promise<Product>>(),
    find: jest.fn<(options: unknown) => Promise<Product[]>>(),
    findOneBy: jest.fn<(where: unknown) => Promise<Product | null>>(),
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

  describe('findAll', () => {
    it('busca só os ativos, mais recentes primeiro', async () => {
      const list = [{ ...dto, id: '1' }] as Product[];
      repository.find.mockResolvedValue(list);

      await expect(service.findAll()).resolves.toBe(list);
      expect(repository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('sem produtos ativos devolve []', async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.findAll()).resolves.toEqual([]);
    });
  });

  describe('findBySeller', () => {
    it('busca só os ativos do vendedor, mais recentes primeiro', async () => {
      const list = [{ ...dto, id: '1', sellerId: seller.id }] as Product[];
      repository.find.mockResolvedValue(list);

      await expect(service.findBySeller(seller.id)).resolves.toBe(list);
      expect(repository.find).toHaveBeenCalledWith({
        where: { sellerId: seller.id, isActive: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('vendedor sem produtos ativos devolve []', async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.findBySeller(seller.id)).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    const id = '9b2e4c1a-7f3d-4e8b-a6c5-1d2f3e4a5b6c';

    it('devolve o produto encontrado', async () => {
      const product = { ...dto, id, isActive: true } as Product;
      repository.findOneBy.mockResolvedValue(product);

      await expect(service.findOne(id)).resolves.toBe(product);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id });
    });

    it('devolve o produto mesmo inativo', async () => {
      const product = { ...dto, id, isActive: false } as Product;
      repository.findOneBy.mockResolvedValue(product);

      await expect(service.findOne(id)).resolves.toBe(product);
    });

    it('produto inexistente → 404', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(id)).rejects.toThrow(
        new NotFoundException(PRODUCT_NOT_FOUND),
      );
    });
  });
});
