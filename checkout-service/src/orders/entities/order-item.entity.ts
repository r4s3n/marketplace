import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';
import { Order } from './order.entity';

// cópia do item no fechamento do pedido: não muda se o carrinho mudar depois
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // apagar o pedido apaga os itens no banco
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' }) // mesma coluna da propriedade orderId
  order: Order;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' }) // produto do products-service, sem FK (banco separado)
  productId: string;

  @Column({ length: 255 })
  productName: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  @Column({ type: 'int' })
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
