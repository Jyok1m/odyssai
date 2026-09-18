import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminPlansService } from './admin-plans.service.js';
import { AdminService } from './admin.service.js';

/**
 * AuthModule pour `SessionGuard`, que Nest construit dans le module qui
 * l'applique. BillingModule pour la resiliation, qui passe par le meme
 * service que le portail du joueur.
 */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [AdminController],
  providers: [AdminService, AdminPlansService, AdminGuard],
})
export class AdminModule {}
