import { ValueTransformer } from 'typeorm';

// o pg devolve decimal como string; o transformer converte de volta para número
export const decimalTransformer: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
