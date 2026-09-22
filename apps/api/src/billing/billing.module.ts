import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

/*
  AuthModule est importe parce que Nest construit SessionGuard dans le module
  qui l'applique, et qu'il lui faut UsersService.
*/
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
