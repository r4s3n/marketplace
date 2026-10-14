import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOneOptions, Repository } from 'typeorm';
import { calculateSubtotal, MAX_MONEY, sumMoney } from '../common/utils/money';
import { ProductsClientService } from '../products-client/products-client.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartStatus } from './enums/cart-status.enum';
import {
  emptyCartResponse,
  toCartResponse,
} from './mappers/cart-response.mapper';

export const PRODUCT_UNAVAILABLE = 'Produto indisponível';
export const ITEM_NOT_FOUND = 'Item não encontrado no carrinho';
export const LIMIT_EXCEEDED = 'Quantidade excede o limite permitido';

// maior valor da coluna int do PostgreSQL
const MAX_QUANTITY = 2_147_483_647;

// trava o carrinho ativo até o fim da transação: serializa as operações do usuário.
// sem eager: o PostgreSQL não aceita FOR UPDATE com o LEFT JOIN dos itens
const lockActiveCart = (userId: string): FindOneOptions<Cart> => ({
  where: { userId, status: CartStatus.ACTIVE },
  lock: { mode: 'pessimistic_write' },
  loadEagerRelations: false,
});

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    private readonly dataSource: DataSource,
    private readonly productsClient: ProductsClientService,
  ) {}

  // só lê o snapshot gravado: não cria carrinho nem chama o products-service
  async getCart(userId: string): Promise<CartResponseDto> {
    const cart = await this.carts.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });
    return cart ? toCartResponse(cart) : emptyCartResponse(userId);
  }

  async addItem(
    userId: string,
    { productId, quantity }: AddCartItemDto,
  ): Promise<CartResponseDto> {
    // valida o produto antes da transação: se falhar, nenhum carrinho é criado
    const product = await this.productsClient.getProduct(productId);
    if (!product.isActive) {
      throw new BadRequestException(PRODUCT_UNAVAILABLE);
    }

    const cartId = await this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreateActiveCart(manager, userId);
      const items = await manager.find(CartItem, {
        where: { cartId: cart.id },
      });

      let item = items.find((i) => i.productId === productId);
      if (!item) {
        item = manager.create(CartItem, {
          cartId: cart.id,
          productId,
          quantity: 0,
        });
        items.push(item);
      }
      // snapshot do momento desta adição: um único preço por item
      item.quantity += quantity;
      item.productName = product.name;
      item.price = product.price;
      item.subtotal = calculateSubtotal(product.price, item.quantity);

      const total = sumMoney(items.map((i) => i.subtotal));
      if (
        item.quantity > MAX_QUANTITY ||
        item.subtotal > MAX_MONEY ||
        total > MAX_MONEY
      ) {
        throw new BadRequestException(LIMIT_EXCEEDED);
      }

      await manager.save(item);
      await manager.update(Cart, cart.id, { total });
      return cart.id;
    });

    return toCartResponse(await this.carts.findOneByOrFail({ id: cartId }));
  }

  async removeItem(userId: string, itemId: string): Promise<CartResponseDto> {
    const cartId = await this.dataSource.transaction(async (manager) => {
      const cart = await manager.findOne(Cart, lockActiveCart(userId));
      if (!cart) {
        throw new NotFoundException(ITEM_NOT_FOUND);
      }

      // filtrar pelo carrinho ativo garante a posse: item de outro usuário vira 404
      const { affected } = await manager.delete(CartItem, {
        id: itemId,
        cartId: cart.id,
      });
      if (!affected) {
        throw new NotFoundException(ITEM_NOT_FOUND);
      }

      const items = await manager.find(CartItem, {
        where: { cartId: cart.id },
      });
      await manager.update(Cart, cart.id, {
        total: sumMoney(items.map((i) => i.subtotal)),
      });
      return cart.id;
    });

    return toCartResponse(await this.carts.findOneByOrFail({ id: cartId }));
  }

  // ON CONFLICT DO NOTHING no índice parcial: requisições simultâneas
  // não criam dois carrinhos ativos nem falham com 500
  private async getOrCreateActiveCart(
    manager: EntityManager,
    userId: string,
  ): Promise<Cart> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Cart)
      .values({ userId, status: CartStatus.ACTIVE, total: 0 })
      .orIgnore()
      .updateEntity(false)
      .execute();
    return manager.findOneOrFail(Cart, lockActiveCart(userId));
  }
}
