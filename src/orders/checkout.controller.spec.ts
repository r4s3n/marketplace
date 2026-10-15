import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../auth/enums/user-role.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { CheckoutController } from './checkout.controller';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentMethod } from './enums/payment-method.enum';
import { OrdersService } from './orders.service';

describe('CheckoutController', () => {
  let controller: CheckoutController;
  const service: { checkout: jest.Mock } = { checkout: jest.fn() };

  const user: AuthenticatedUser = {
    id: '3f6c1b8e-2a4d-4c7e-9b1a-8d2f5e6a7c90',
    email: 'maria@example.com',
    role: UserRole.BUYER,
  };
  const req: AuthenticatedRequest = { user } as AuthenticatedRequest;
  const order: { id: string; userId: string } = {
    id: 'order',
    userId: user.id,
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [{ provide: OrdersService, useValue: service }],
    }).compile();

    controller = module.get(CheckoutController);
  });

  it('POST /cart/checkout repassa o id do usuário e o corpo', async () => {
    const dto: CheckoutDto = { paymentMethod: PaymentMethod.PIX };
    service.checkout.mockResolvedValue(order);

    await expect(controller.checkout(dto, req)).resolves.toBe(order);
    expect(service.checkout).toHaveBeenCalledWith(user.id, dto);
  });
});
