import { Module } from '@nestjs/common';
import { AlphaModule } from '../alpha/alpha.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContactModule } from '../contact/contact.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminPlansService } from './admin-plans.service.js';
import { AdminService } from './admin.service.js';

/*
  AuthModule pour `SessionGuard`, que Nest construit dans le module qui
  l'applique. BillingModule pour la resiliation, qui passe par le meme
  service que le portail du joueur. AlphaModule pour l'etat annonce, dont la
  lecture est publique et l'ecriture reservee.
*/
@Module({
  imports: [AuthModule, BillingModule, AlphaModule, ContactModule],
  controllers: [AdminController],
  providers: [AdminService, AdminPlansService, AdminGuard],
})
export class AdminModule {}
