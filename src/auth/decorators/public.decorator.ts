import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic'; // crio uma variavel para colocar salvar a chave isPublic

// Exporto uma constante Public onde seto no metadado a chave publica e um true que valida que é publico
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
