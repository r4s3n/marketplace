import { CartResponseDto } from '../dto/cart-response.dto';
import { Cart } from '../entities/cart.entity';
import { CartStatus } from '../enums/cart-status.enum';

// itens do mais antigo para o mais recente, sem cart nem cartId
export const toCartResponse = (cart: Cart): CartResponseDto => ({
  id: cart.id,
  userId: cart.userId,
  status: cart.status,
  total: cart.total,
  items: [...(cart.items ?? [])]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(
      ({
        id,
        productId,
        productName,
        price,
        quantity,
        subtotal,
        createdAt,
      }) => ({
        id,
        productId,
        productName,
        price,
        quantity,
        subtotal,
        createdAt,
      }),
    ),
  createdAt: cart.createdAt,
  updatedAt: cart.updatedAt,
});

// usuário sem carrinho ativo: resposta vazia, nada é gravado no banco
export const emptyCartResponse = (userId: string): CartResponseDto => ({
  id: null,
  userId,
  status: CartStatus.ACTIVE,
  total: 0,
  items: [],
  createdAt: null,
  updatedAt: null,
});
