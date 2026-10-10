import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])], // disponibiliza o repositório de User
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
