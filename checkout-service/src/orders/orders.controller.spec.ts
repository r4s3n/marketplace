import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  const service: { findAll: jest.Mock; findOne: jest.Mock } = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'maria@example.com',
    role: UserRole.SELLER,
  };
  const req: AuthenticatedRequest = { user } as AuthenticatedRequest;
  const order: { id: string; userId: string } = {
    id: '0b7f5c2e-6a1d-4f3b-9c8e-2d4a6b8c0e1f',
    userId: user.id,
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: service }],
    }).compile();

    controller = module.get(OrdersController);
  });

  it('GET /orders repassa o id do usuário autenticado', async () => {
    const orders: { id: string; userId: string }[] = [order];
    service.findAll.mockResolvedValue(orders);

    await expect(controller.findAll(req)).resolves.toBe(orders);
    expect(service.findAll).toHaveBeenCalledWith(user.id);
  });

  it('GET /orders/:id repassa o id do usuário e o id do pedido', async () => {
    service.findOne.mockResolvedValue(order);

    await expect(controller.findOne(order.id, req)).resolves.toBe(order);
    expect(service.findOne).toHaveBeenCalledWith(user.id, order.id);
  });
});
