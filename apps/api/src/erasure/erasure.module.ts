import { Module } from '@nestjs/common';
import { ErasureService } from './erasure.service.js';

// Sans import : PrismaModule et RedisModule sont globaux, et le service ne
// depend que d'eux et de Stripe, global lui aussi.
@Module({
  providers: [ErasureService],
  exports: [ErasureService],
})
export class ErasureModule {}
