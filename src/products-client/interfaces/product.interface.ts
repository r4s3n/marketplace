// contrato local do produto do products-service: só os campos usados pelo carrinho
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  isActive: boolean;
  sellerId: string;
}
