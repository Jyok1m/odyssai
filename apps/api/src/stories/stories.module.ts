import { Module } from '@nestjs/common';
import { ChronicleService } from './chronicle.service.js';
import { StoriesService } from './stories.service.js';

/*
  Sans import : PrismaModule est global. Le controleur vit dans
  OnboardingModule, qui a deja le garde de session ; l'importer ici ferait
  Auth vers Erasure vers Stories vers Auth.
*/
@Module({
  providers: [StoriesService, ChronicleService],
  exports: [StoriesService, ChronicleService],
})
export class StoriesModule {}
