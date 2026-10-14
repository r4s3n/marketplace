import { decimalTransformer } from './decimal.transformer';

describe('decimalTransformer', () => {
  it('converte o decimal lido do banco para número', () => {
    expect(decimalTransformer.from('349.90')).toBe(349.9);
  });

  it('mantém null na leitura', () => {
    expect(decimalTransformer.from(null)).toBeNull();
  });

  it('repassa o número sem alteração na escrita', () => {
    expect(decimalTransformer.to(199.99)).toBe(199.99);
  });
});
