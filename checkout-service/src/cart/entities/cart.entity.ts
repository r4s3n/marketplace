import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';
import { CartStatus } from '../enums/cart-status.enum';
import { CartItem } from './cart-item.entity';

// no máximo um carrinho active por usuário (completed e abandoned não contam)
@Index('UQ_carts_user_active', ['userId'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Entity('carts')
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' }) // usuário do users-service, sem FK (banco separado)
  userId: string;

  @Column({ type: 'enum', enum: CartStatus, default: CartStatus.ACTIVE })
  status: CartStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  total: number;

  // cascade: salvar o carrinho persiste os itens; eager: itens vêm no find
  @OneToMany(() => CartItem, (item) => item.cart, {
    cascade: true,
    eager: true,
  })
  items: CartItem[];

  // timestamptz: guarda o instante em UTC e o Node lê sem depender do fuso local
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
