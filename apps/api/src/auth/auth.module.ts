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
  // UsersModule est reexporte parce que Nest construit SessionGuard dans le
  // module qui s'en sert : sans cela, chaque module de jeu devrait connaitre
  // les dependances internes du garde pour pouvoir l'appliquer.
  exports: [SessionService, SessionGuard, UsersModule],
})
export class AuthModule {}
