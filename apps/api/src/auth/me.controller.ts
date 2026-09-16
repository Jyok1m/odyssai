import { Controller, Get, UseGuards } from '@nestjs/common';
import type { PlayerProfile } from '@odyssai/schemas';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';

/**
 * Profil de jeu du joueur connecte. Distinct de /auth/session, qui ne dit que
 * l'etat d'authentification et ce que le realm en sait : le pseudo, la langue
 * et les droits de maitre du jeu n'existent que dans la base applicative.
 */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: User): PlayerProfile {
    return {
      id: user.id,
      username: user.username,
      locale: user.locale,
      isAdmin: user.isAdmin,
      email: user.email,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
