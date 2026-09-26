import { Module } from '@nestjs/common';
import { AlphaModule } from '../alpha/alpha.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ErasureModule } from '../erasure/erasure.module.js';
import { StoriesModule } from '../stories/stories.module.js';
import { PartyController } from './party.controller.js';
import { PartyService } from './party.service.js';

/*
  Une couche sur l'entree en jeu, pas une seconde boucle : le module
  n'apporte que la table et ses sieges, le parcours et le tour lisent
  l'histoire comme ils la lisaient. Les credits viennent de CreditsModule,
  global.
*/
@Module({
  imports: [AuthModule, AlphaModule, ErasureModule, StoriesModule],
  controllers: [PartyController],
  providers: [PartyService],
  exports: [PartyService],
})
export class PartyModule {}
