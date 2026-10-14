import { Test, TestingModule } from '@nestjs/testing';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentQueueService } from './payment-queue.service';

describe('PaymentQueueService', () => {
  let service: PaymentQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentQueueService,
        // mock: o teste não deve depender do RabbitMQ
        { provide: RabbitmqService, useValue: { publishMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentQueueService>(PaymentQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
