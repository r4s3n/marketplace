import { BadRequestException } from '@nestjs/common';

// codifica o parâmetro como um único segmento do caminho
// '.' e '..' são barrados: o axios normaliza a URL e eles subiriam de rota no serviço de destino
export function segment(value: string): string {
  if (value === '.' || value === '..') {
    throw new BadRequestException('Parâmetro de rota inválido');
  }
  return encodeURIComponent(value);
}
