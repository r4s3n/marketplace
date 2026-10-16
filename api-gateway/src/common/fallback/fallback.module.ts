import { Module } from '@nestjs/common';
import { CacheFallbackService } from './cache.fallback';
import { defaultFallbackService } from './default.fallback';

@Module({
  providers: [CacheFallbackService, defaultFallbackService],
  exports: [CacheFallbackService, defaultFallbackService],
})
export class FallbackModule {}
