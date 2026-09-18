import { Module } from '@nestjs/common';
import { AlphaController } from './alpha.controller.js';
import { AlphaService } from './alpha.service.js';

/** Sans import : PrismaModule est global, et le service ne depend que de lui. */
@Module({
  controllers: [AlphaController],
  providers: [AlphaService],
  exports: [AlphaService],
})
export class AlphaModule {}
