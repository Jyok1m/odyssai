import { Module } from '@nestjs/common';
import { ErasureService } from './erasure.service.js';

/** Sans import : PrismaModule est global, et le service ne depend que de lui. */
@Module({
  providers: [ErasureService],
  exports: [ErasureService],
})
export class ErasureModule {}
