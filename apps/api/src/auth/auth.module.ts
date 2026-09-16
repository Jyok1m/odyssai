import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { OidcService } from './oidc.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, MeController],
  providers: [OidcService, SessionService, SessionGuard],
  // Exportes pour les futurs modules de jeu.
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
