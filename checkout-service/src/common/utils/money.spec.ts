import { calculateSubtotal, sumMoney } from './money';

describe('money', () => {
  describe('calculateSubtotal', () => {
    it('multiplica preço por quantidade com 2 casas', () => {
      expect(calculateSubtotal(19.99, 3)).toBe(59.97);
    });

    it('não acumula erro de ponto flutuante', () => {
      expect(calculateSubtotal(0.1, 3)).toBe(0.3);
    });
  });

  describe('sumMoney', () => {
    it('soma 0.10 e 0.20 resultando exatamente 0.3', () => {
      expect(sumMoney([0.1, 0.2])).toBe(0.3);
    });

    it('lista vazia soma 0', () => {
      expect(sumMoney([])).toBe(0);
    });
  });
});
