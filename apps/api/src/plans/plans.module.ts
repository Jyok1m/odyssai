import { Global, Module } from '@nestjs/common';
import { PlansService } from './plans.service.js';

/** Global : les credits, la facturation et l'administration le lisent tous. */
@Global()
@Module({
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
