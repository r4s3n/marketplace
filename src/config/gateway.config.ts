export const serviceConfig = {
  users: {
    url: process.env.USERS_SERVICE_URL || 'http://localhost:3000',
    timeout: 10000, // 10 mil milisegundos
  },
  products: {
    url: process.env.PRODUCTS_SERVICE_URL || 'http://localhost:3001',
    timeout: 10000,
  },
  checkout: {
    url: process.env.CHECKOUT_SERVICE_URL || 'http://localhost:3003',
    timeout: 10000,
  },
  payment: {
    url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3004',
    timeout: 10000,
  },
} as const; // declaro que é constante para funcionar de maneira correta!
