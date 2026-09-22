import { Global, Module } from '@nestjs/common';
import { CreditsService } from './credits.service.js';

/*
  Global : tous les chemins facturables le consomment, et il ne depend que
  de PrismaModule, lui-meme global.
*/
@Global()
@Module({
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
