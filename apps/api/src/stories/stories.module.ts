import { Module } from '@nestjs/common';
import { StoriesService } from './stories.service.js';

/*
  Sans import : PrismaModule est global. Le controleur vit dans
  OnboardingModule, qui a deja le garde de session ; l'importer ici ferait
  Auth vers Erasure vers Stories vers Auth.
*/
@Module({
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
