import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// @ApiProperty só documenta a resposta no Swagger, sem afetar as colunas
@Entity('products')
export class Product {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Teclado mecânico' })
  @Column({ length: 255 })
  name: string;

  @ApiProperty({ example: 'Teclado mecânico ABNT2 com switches marrons' })
  @Column({ type: 'text' })
  description: string;

  // o pg devolve decimal como string; o transformer converte de volta para número
  @ApiProperty({ example: 349.9 })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  price: number;

  @ApiProperty({ type: 'integer', example: 15 })
  @Column({ type: 'int', default: 0 })
  stock: number;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' }) // usuário do users-service, sem FK (banco separado)
  sellerId: string;

  @ApiProperty({ example: true })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty()
  // timestamptz: guarda o instante em UTC e o Node lê sem depender do fuso local
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
