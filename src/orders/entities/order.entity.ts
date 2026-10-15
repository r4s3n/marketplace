import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' }) // usuário do users-service, sem FK (banco separado)
  userId: string;

  @Column({ type: 'uuid' }) // carrinho de origem: só a referência, sem relação
  cartId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  total: number;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  // varchar explícito: o enum fica só no TypeScript, a coluna não muda
  @Column({ type: 'varchar', length: 50 }) // o mesmo valor enviado ao payments-service
  paymentMethod: PaymentMethod;

  // cascade: salvar o pedido persiste os itens; eager: itens vêm no find
  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItem[];

  // timestamptz: guarda o instante em UTC e o Node lê sem depender do fuso local
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
