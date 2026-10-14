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
  createdAt?: string; // ISO 8601: é o formato que chega no JSON da fila
  metadata?: {
    service: string;
    timeStamp: string;
  };
}
