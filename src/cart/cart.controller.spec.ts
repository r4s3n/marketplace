import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

describe('CartController', () => {
  let controller: CartController;
  const service = {
    getCart: jest.fn(),
    addItem: jest.fn(),
    removeItem: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'maria@example.com',
    role: UserRole.BUYER,
  };
  const req = { user } as Parameters<CartController['getCart']>[0];
  const cart = { id: 'cart', userId: user.id };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CartController],
      providers: [{ provide: CartService, useValue: service }],
    }).compile();

    controller = module.get(CartController);
  });

  it('GET /cart repassa o id do usuário autenticado', async () => {
    service.getCart.mockResolvedValue(cart);

    await expect(controller.getCart(req)).resolves.toBe(cart);
    expect(service.getCart).toHaveBeenCalledWith(user.id);
  });

  it('POST /cart/items repassa o id do usuário e o corpo', async () => {
    const dto = {
      productId: 'c9d8e7f6-a5b4-4c3d-8e1f-0a9b8c7d6e5f',
      quantity: 2,
    };
    service.addItem.mockResolvedValue(cart);

    await expect(controller.addItem(dto, req)).resolves.toBe(cart);
    expect(service.addItem).toHaveBeenCalledWith(user.id, dto);
  });

  it('DELETE /cart/items/:itemId repassa o id do usuário e o itemId', async () => {
    const itemId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    service.removeItem.mockResolvedValue(cart);

    await expect(controller.removeItem(itemId, req)).resolves.toBe(cart);
    expect(service.removeItem).toHaveBeenCalledWith(user.id, itemId);
  });
});
