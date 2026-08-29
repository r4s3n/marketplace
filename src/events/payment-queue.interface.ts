export interface PaymentOrderMessage {
  orderId: string;
  userId: string;
  amount: number;
  items: Array<{
    // mandamos os produtos aqui tbm para verificação posteriormente, eles já ficam no orderId
    productId: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  description?: string;
  createdAt?: Date;
}
