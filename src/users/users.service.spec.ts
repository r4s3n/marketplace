import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';

describe('UsersService', () => {
  let service: UsersService;
  const repository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findByEmail busca o usuário pelo e-mail', async () => {
    const user = { id: '1', email: 'maria@example.com' } as User;
    repository.findOne.mockResolvedValue(user);

    await expect(service.findByEmail('maria@example.com')).resolves.toBe(user);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'maria@example.com' },
    });
  });

  it('create cria e salva o usuário', async () => {
    const data = {
      email: 'maria@example.com',
      password: 'hash',
      firstName: 'Maria',
      lastName: 'Silva',
      role: UserRole.BUYER,
      status: UserStatus.ACTIVE,
    };
    const entity = { ...data } as User;
    const saved = { ...data, id: '1' } as User;
    repository.create.mockReturnValue(entity);
    repository.save.mockResolvedValue(saved);

    await expect(service.create(data)).resolves.toBe(saved);
    expect(repository.create).toHaveBeenCalledWith(data);
    expect(repository.save).toHaveBeenCalledWith(entity);
  });
});
