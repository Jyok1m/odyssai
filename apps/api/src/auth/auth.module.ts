import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { OidcService } from './oidc.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [OidcService, SessionService, SessionGuard],
  // SessionGuard et SessionService sont exportes pour les futurs modules de
  // jeu, qui protegent leurs routes sans reimplementer la lecture de session.
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
