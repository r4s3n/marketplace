import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product])], // disponibiliza o repositório de Product
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
