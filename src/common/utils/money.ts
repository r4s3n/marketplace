// maior valor que cabe em decimal(10,2)
export const MAX_MONEY = 99_999_999.99;

// trabalha em centavos inteiros para não acumular erro de ponto flutuante
const toCents = (value: number) => Math.round(value * 100);

export const calculateSubtotal = (price: number, quantity: number): number =>
  (toCents(price) * quantity) / 100;

export const sumMoney = (values: number[]): number =>
  values.reduce((acc, value) => acc + toCents(value), 0) / 100;
