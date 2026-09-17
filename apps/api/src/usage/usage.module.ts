import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service.js';

/** Global : tous les points d'appel le consomment, et il ne depend que de
 * PrismaModule, lui-meme global. */
@Global()
@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
