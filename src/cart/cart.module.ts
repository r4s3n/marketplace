import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsClientModule } from '../products-client/products-client.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem]), // disponibiliza os repositórios de Cart e CartItem
    ProductsClientModule, // busca preço, nome e status do produto
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService], // usado pelo OrdersModule no checkout
})
export class CartModule {}
