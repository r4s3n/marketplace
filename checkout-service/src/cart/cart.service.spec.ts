import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Product } from '../products-client/interfaces/product.interface';
import { ProductsClientService } from '../products-client/products-client.service';
import {
  CartService,
  ITEM_NOT_FOUND,
  LIMIT_EXCEEDED,
  PRODUCT_UNAVAILABLE,
} from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartStatus } from './enums/cart-status.enum';

const userId = '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90';
const cartId = '6f1c2b0e-8a4d-4f7e-9b1a-2d3c4e5f6a7b';
const productId = 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f';

const product: Product = {
  id: productId,
  name: 'Teclado mecânico',
  price: 19.99,
  stock: 10,
  isActive: true,
  sellerId: '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
};

const makeCart = (items: Partial<CartItem>[] = [], total = 0): Cart => ({
  id: cartId,
  userId,
  status: CartStatus.ACTIVE,
  total,
  items: items as CartItem[],
  createdAt: new Date('2026-10-14T20:00:00.000Z'),
  updatedAt: new Date('2026-10-14T20:00:00.000Z'),
});

const makeItem = (data: Partial<CartItem>): CartItem =>
  ({
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    cartId,
    createdAt: new Date('2026-10-14T20:00:00.000Z'),
    ...data,
  }) as CartItem;

describe('CartService', () => {
  let service: CartService;

  const repository = { findOne: jest.fn(), findOneByOrFail: jest.fn() };
  const productsClient = { getProduct: jest.fn() };

  // insert ... on conflict do nothing encadeado do QueryBuilder
  const insertChain = {
    insert: jest.fn(),
    into: jest.fn(),
    values: jest.fn(),
    orIgnore: jest.fn(),
    updateEntity: jest.fn(),
    execute: jest.fn(),
  };
  const manager = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of ['insert', 'into', 'values', 'orIgnore', 'updateEntity']) {
      insertChain[fn as keyof typeof insertChain].mockReturnValue(insertChain);
    }
    manager.createQueryBuilder.mockReturnValue(insertChain);
    manager.create.mockImplementation((_, data: Partial<CartItem>) => ({
      ...data,
    }));
    manager.save.mockImplementation((item: CartItem) => item);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: getRepositoryToken(Cart), useValue: repository },
        { provide: DataSource, useValue: dataSource },
        { provide: ProductsClientService, useValue: productsClient },
      ],
    }).compile();

    service = module.get(CartService);
  });

  describe('getCart', () => {
    it('sem carrinho ativo devolve o carrinho vazio sem gravar nada', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.getCart(userId)).resolves.toStrictEqual({
        id: null,
        userId,
        status: CartStatus.ACTIVE,
        total: 0,
        items: [],
        createdAt: null,
        updatedAt: null,
      });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId, status: CartStatus.ACTIVE },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(productsClient.getProduct).not.toHaveBeenCalled();
    });

    it('com carrinho ativo devolve itens em ordem de entrada, sem cart nem cartId', async () => {
      const newer = makeItem({
        id: 'b',
        productName: 'Mouse',
        price: 10,
        quantity: 1,
        subtotal: 10,
        createdAt: new Date('2026-10-14T21:00:00.000Z'),
      });
      const older = makeItem({
        id: 'a',
        productName: 'Teclado',
        price: 20,
        quantity: 1,
        subtotal: 20,
      });
      repository.findOne.mockResolvedValue(makeCart([newer, older], 30));

      const result = await service.getCart(userId);

      expect(result.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(result.items[0]).not.toHaveProperty('cartId');
      expect(result.items[0]).not.toHaveProperty('cart');
      expect(result.total).toBe(30);
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      productsClient.getProduct.mockResolvedValue(product);
      manager.findOne.mockResolvedValue(makeCart());
      repository.findOneByOrFail.mockResolvedValue(makeCart());
    });

    it('produto inativo → 400 sem abrir transação', async () => {
      productsClient.getProduct.mockResolvedValue({
        ...product,
        isActive: false,
      });

      const promise = service.addItem(userId, { productId, quantity: 1 });
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(PRODUCT_UNAVAILABLE);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([
      new NotFoundException('Produto não encontrado'),
      new ServiceUnavailableException('Serviço de produtos indisponível'),
    ])(
      'erro do products-service (%s) é propagado sem transação',
      async (error) => {
        productsClient.getProduct.mockRejectedValue(error);

        await expect(
          service.addItem(userId, { productId, quantity: 1 }),
        ).rejects.toBe(error);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('garante o carrinho com insert on conflict do nothing e trava a linha', async () => {
      manager.find.mockResolvedValue([]);

      await service.addItem(userId, { productId, quantity: 1 });

      expect(insertChain.values).toHaveBeenCalledWith({
        userId,
        status: CartStatus.ACTIVE,
        total: 0,
      });
      expect(insertChain.orIgnore).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      expect(insertChain.execute).toHaveBeenCalledTimes(1);
      expect(manager.findOneOrFail).not.toHaveBeenCalled();
    });

    it('carrinho concluído por um checkout concorrente: cria outro carrinho ativo', async () => {
      const newCart: Cart = { ...makeCart(), id: 'novo-carrinho' };
      manager.findOne.mockResolvedValueOnce(null);
      manager.findOneOrFail.mockResolvedValue(newCart);
      manager.find.mockResolvedValue([]);

      await service.addItem(userId, { productId, quantity: 1 });

      expect(insertChain.execute).toHaveBeenCalledTimes(2);
      expect(manager.findOneOrFail).toHaveBeenCalledWith(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ cartId: 'novo-carrinho', productId }),
      );
    });

    it('produto novo cria o item com snapshot, subtotal e total', async () => {
      manager.find.mockResolvedValue([]);

      await service.addItem(userId, { productId, quantity: 3 });

      expect(manager.save).toHaveBeenCalledWith({
        cartId,
        productId,
        quantity: 3,
        productName: product.name,
        price: 19.99,
        subtotal: 59.97,
      });
      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, {
        total: 59.97,
      });
    });

    it('produto já no carrinho soma a quantidade e atualiza o snapshot para o preço atual', async () => {
      const existing = makeItem({
        productId,
        productName: 'Nome antigo',
        price: 19.99,
        quantity: 2,
        subtotal: 39.98,
      });
      manager.find.mockResolvedValue([existing]);
      productsClient.getProduct.mockResolvedValue({ ...product, price: 25 });

      await service.addItem(userId, { productId, quantity: 3 });

      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: existing.id,
          productName: product.name,
          price: 25,
          quantity: 5,
          subtotal: 125,
        }),
      );
      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, {
        total: 125,
      });
    });

    it('total soma todos os itens sem erro de ponto flutuante (0.10 + 0.20 = 0.3)', async () => {
      manager.find.mockResolvedValue([
        makeItem({
          productId: 'outro',
          price: 0.1,
          quantity: 1,
          subtotal: 0.1,
        }),
      ]);
      productsClient.getProduct.mockResolvedValue({ ...product, price: 0.2 });

      await service.addItem(userId, { productId, quantity: 1 });

      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, { total: 0.3 });
    });

    it('total acima do limite do decimal(10,2) → 400 sem gravar', async () => {
      manager.find.mockResolvedValue([]);
      productsClient.getProduct.mockResolvedValue({ ...product, price: 99999 });

      const promise = service.addItem(userId, { productId, quantity: 1001 });
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(LIMIT_EXCEEDED);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('falha ao gravar o item é propagada e o total não é atualizado', async () => {
      manager.find.mockResolvedValue([]);
      manager.save.mockRejectedValue(new Error('falha no banco'));

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toThrow('falha no banco');
      expect(manager.update).not.toHaveBeenCalled();
      expect(repository.findOneByOrFail).not.toHaveBeenCalled();
    });

    it('devolve o carrinho relido do banco depois da transação', async () => {
      manager.find.mockResolvedValue([]);
      const saved = makeCart(
        [
          makeItem({
            productId,
            productName: product.name,
            price: 19.99,
            quantity: 1,
            subtotal: 19.99,
          }),
        ],
        19.99,
      );
      repository.findOneByOrFail.mockResolvedValue(saved);

      const result = await service.addItem(userId, { productId, quantity: 1 });

      expect(repository.findOneByOrFail).toHaveBeenCalledWith({ id: cartId });
      expect(result.id).toBe(cartId);
      expect(result.total).toBe(19.99);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('removeItem', () => {
    const itemId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('sem carrinho ativo → 404', async () => {
      manager.findOne.mockResolvedValue(null);

      const promise = service.removeItem(userId, itemId);
      await expect(promise).rejects.toThrow(NotFoundException);
      await expect(promise).rejects.toThrow(ITEM_NOT_FOUND);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('item fora do carrinho ativo do usuário → 404 sem recalcular', async () => {
      manager.findOne.mockResolvedValue(makeCart());
      manager.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(service.removeItem(userId, itemId)).rejects.toThrow(
        ITEM_NOT_FOUND,
      );
      // o filtro pelo cartId garante a posse
      expect(manager.delete).toHaveBeenCalledWith(CartItem, {
        id: itemId,
        cartId,
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('remove o item e recalcula o total com os restantes', async () => {
      manager.findOne.mockResolvedValue(makeCart());
      manager.delete.mockResolvedValue({ affected: 1, raw: [] });
      manager.find.mockResolvedValue([makeItem({ id: 'outro', subtotal: 10 })]);
      repository.findOneByOrFail.mockResolvedValue(makeCart([], 10));

      await service.removeItem(userId, itemId);

      expect(manager.findOne).toHaveBeenCalledWith(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, { total: 10 });
    });

    it('remover o último item deixa o carrinho ativo com total 0', async () => {
      manager.findOne.mockResolvedValue(makeCart());
      manager.delete.mockResolvedValue({ affected: 1, raw: [] });
      manager.find.mockResolvedValue([]);
      repository.findOneByOrFail.mockResolvedValue(makeCart([], 0));

      const result = await service.removeItem(userId, itemId);

      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, { total: 0 });
      expect(result).toMatchObject({
        id: cartId,
        status: CartStatus.ACTIVE,
        total: 0,
        items: [],
      });
    });

    it('não chama o products-service', async () => {
      manager.findOne.mockResolvedValue(makeCart());
      manager.delete.mockResolvedValue({ affected: 1, raw: [] });
      manager.find.mockResolvedValue([]);
      repository.findOneByOrFail.mockResolvedValue(makeCart());

      await service.removeItem(userId, itemId);

      expect(productsClient.getProduct).not.toHaveBeenCalled();
    });
  });

  describe('findActiveCartForCheckout', () => {
    it('trava o carrinho ativo e carrega os itens à parte', async () => {
      const items: CartItem[] = [makeItem({ productId, subtotal: 59.97 })];
      manager.findOne.mockResolvedValue(makeCart());
      manager.find.mockResolvedValue(items);

      const result: Cart | null = await service.findActiveCartForCheckout(
        manager as unknown as EntityManager,
        userId,
      );

      expect(manager.findOne).toHaveBeenCalledWith(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      expect(manager.find).toHaveBeenCalledWith(CartItem, {
        where: { cartId },
      });
      expect(result?.id).toBe(cartId);
      expect(result?.items).toBe(items);
    });

    it('sem carrinho ativo devolve null sem buscar itens', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.findActiveCartForCheckout(
          manager as unknown as EntityManager,
          userId,
        ),
      ).resolves.toBeNull();
      expect(manager.find).not.toHaveBeenCalled();
    });
  });

  describe('completeCart', () => {
    it('muda o status do carrinho para completed', async () => {
      manager.update.mockResolvedValue({ affected: 1 });

      await service.completeCart(manager as unknown as EntityManager, cartId);

      expect(manager.update).toHaveBeenCalledWith(Cart, cartId, {
        status: CartStatus.COMPLETED,
      });
    });
  });
});
