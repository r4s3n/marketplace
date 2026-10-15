import request from 'supertest';

// fluxo de carrinho e pedidos somente pelo gateway (porta 3005), com os serviços reais no ar
// roda com `pnpm run test:e2e:checkout`; fica fora do `test:e2e` padrão

interface CartItem {
  id: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  subtotal: number;
}

interface Cart {
  id: string | null;
  status: string;
  total: number;
  items: CartItem[];
}

interface Order {
  id: string;
  status: string;
  paymentMethod: string;
  total: number;
  items: CartItem[];
}

const baseUrl = process.env.GATEWAY_URL ?? 'http://localhost:3005';

// e-mails e user-agent únicos por execução: o teste pode rodar várias vezes seguidas
// e o CustomThrottlerGuard (IP + user-agent) dá a cada execução a sua própria contagem
const runId = Date.now();
const userAgent = `checkout-flow-e2e/${runId}`;
const password = 'senha123';
const sellerEmail = `seller-${runId}@example.com`;
const buyerEmail = `buyer-${runId}@example.com`;

const http = {
  get: (path: string, token?: string) =>
    withHeaders(request(baseUrl).get(path), token),
  post: (path: string, body: object, token?: string) =>
    withHeaders(request(baseUrl).post(path), token).send(body),
  delete: (path: string, token?: string) =>
    withHeaders(request(baseUrl).delete(path), token),
};

function withHeaders(req: request.Test, token?: string) {
  req.set('User-Agent', userAgent);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

const sumSubtotals = (items: CartItem[]) =>
  items.reduce((sum, item) => sum + item.subtotal, 0);

async function registerAndLogin(email: string, role: 'seller' | 'buyer') {
  await http
    .post('/auth/register', {
      email,
      password,
      firstName: 'E2E',
      lastName: role,
      role,
    })
    .expect(201);

  const res = await http.post('/auth/login', { email, password }).expect(200);
  const { token } = res.body as { token: string };
  expect(typeof token).toBe('string');
  return token;
}

describe('Fluxo de checkout via api-gateway (e2e)', () => {
  let buyerToken: string;
  let productId: string;
  let productName: string;
  let productPrice: number;
  let cart: Cart;
  let order: Order;

  beforeAll(async () => {
    // falha cedo, com mensagem clara, se o gateway não estiver no ar
    try {
      await request(baseUrl).get('/health/live').set('User-Agent', userAgent);
    } catch {
      throw new Error(
        `api-gateway não respondeu em ${baseUrl}. Suba os serviços antes (ver README).`,
      );
    }
  });

  it('prepara um seller com produto ativo e um buyer', async () => {
    const sellerToken = await registerAndLogin(sellerEmail, 'seller');

    productName = `Produto E2E ${runId}`;
    const res = await http
      .post(
        '/products',
        {
          name: productName,
          description: 'Produto criado pelo e2e de checkout',
          price: 49.9,
          stock: 10,
        },
        sellerToken,
      )
      .expect(201);
    const product = res.body as {
      id: string;
      price: number;
      isActive: boolean;
    };
    expect(product.isActive).toBe(true);
    productId = product.id;
    productPrice = product.price;

    buyerToken = await registerAndLogin(buyerEmail, 'buyer');
  });

  it('GET /cart sem token → 401', async () => {
    await http.get('/cart').expect(401);
  });

  it('POST /cart/items e DELETE /cart/items/:itemId → item adicionado e removido', async () => {
    const added = await http
      .post('/cart/items', { productId, quantity: 1 }, buyerToken)
      .expect(201);
    const itemId = (added.body as Cart).items[0].id;

    const removed = await http
      .delete(`/cart/items/${itemId}`, buyerToken)
      .expect(200);
    expect((removed.body as Cart).items).toEqual([]);
  });

  it('POST /cart/items → 201 com o item, nome e preço do produto', async () => {
    const res = await http
      .post('/cart/items', { productId, quantity: 2 }, buyerToken)
      .expect(201);
    cart = res.body as Cart;

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      productId,
      productName,
      price: productPrice,
      quantity: 2,
    });
    expect(cart.total).toBeCloseTo(sumSubtotals(cart.items), 2);
  });

  it('GET /cart → 200 com o mesmo carrinho ativo', async () => {
    const res = await http.get('/cart', buyerToken).expect(200);
    const current = res.body as Cart;

    expect(current.id).toBe(cart.id);
    expect(current.status).toBe('active');
    expect(current.total).toBe(cart.total);
    expect(current.items.map((item) => item.id)).toEqual(
      cart.items.map((item) => item.id),
    );
  });

  it('POST /cart/checkout → 201 com pedido pending, mesmos itens e total', async () => {
    const res = await http
      .post('/cart/checkout', { paymentMethod: 'pix' }, buyerToken)
      .expect(201);
    order = res.body as Order;

    expect(order.status).toBe('pending');
    expect(order.paymentMethod).toBe('pix');
    expect(order.total).toBe(cart.total);
    expect(order.items).toHaveLength(cart.items.length);
    expect(order.items[0]).toMatchObject({
      productId,
      productName,
      price: productPrice,
      quantity: 2,
    });
  });

  it('GET /orders e GET /orders/:id → 200 com o pedido', async () => {
    const list = await http.get('/orders', buyerToken).expect(200);
    expect((list.body as Order[]).map((o) => o.id)).toContain(order.id);

    const one = await http.get(`/orders/${order.id}`, buyerToken).expect(200);
    expect((one.body as Order).id).toBe(order.id);
    expect((one.body as Order).total).toBe(order.total);
  });

  it('GET /orders/<uuid aleatório> → 404', async () => {
    await http
      .get('/orders/00000000-0000-4000-8000-000000000000', buyerToken)
      .expect(404);
  });

  it('GET /cart após o checkout → 200 com carrinho vazio', async () => {
    const res = await http.get('/cart', buyerToken).expect(200);
    const empty = res.body as Cart;

    expect(empty.id).toBeNull();
    expect(empty.items).toEqual([]);
  });
});
