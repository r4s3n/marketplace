import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

// valida o parâmetro antes do banco: sem isso, um id malformado vira 500 no pg
export const uuidPipe = (param: string): ParseUUIDPipe =>
  new ParseUUIDPipe({
    exceptionFactory: (): BadRequestException =>
      new BadRequestException(`${param} deve ser um UUID válido`),
  });
