import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';
import { Cart } from './cart.entity';

// um item por produto no carrinho: adicionar de novo soma a quantidade
@Index('UQ_cart_items_cart_product', ['cartId', 'productId'], { unique: true })
@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // apagar o carrinho apaga os itens no banco
  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' }) // mesma coluna da propriedade cartId
  cart: Cart;

  @Column({ type: 'uuid' })
  cartId: string;

  @Column({ type: 'uuid' }) // produto do products-service, sem FK (banco separado)
  productId: string;

  // nome e preço copiados no momento da adição ao carrinho
  @Column({ length: 255 })
  productName: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  subtotal: number;

  // timestamptz: guarda o instante em UTC e o Node lê sem depender do fuso local
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
