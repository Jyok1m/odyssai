import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  UpdateProfileRequestSchema,
  type PlayerProfile,
} from '@odyssai/schemas';
import { AppConfig } from '../config/app-config.js';
import type { User } from '@odyssai/db';
import {
  UsernameLockedError,
  UsernameTakenError,
  UsersService,
} from '../users/users.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';

/**
 * Profil de jeu du joueur connecte. Distinct de /auth/session, qui ne dit que
 * l'etat d'authentification et ce que le realm en sait : le pseudo, la langue
 * et les droits de maitre du jeu n'existent que dans la base applicative.
 *
 * L'email et le mot de passe ne sont pas modifiables ici : ils appartiennent
 * au realm, et la console de compte de Keycloak les sert.
 */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  me(@CurrentUser() user: User): PlayerProfile {
    return this.toProfile(user);
  }

  @Patch()
  async update(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
  ): Promise<PlayerProfile> {
    const parsed = UpdateProfileRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'validation_error' });
    }

    try {
      const updated = await this.users.setUsername(
        user.id,
        parsed.data.username,
      );
      return this.toProfile(updated);
    } catch (error: unknown) {
      // Le pseudo est affiche aux autres joueurs : le conflit est un cas
      // metier, pas une panne, et le front doit pouvoir le dire.
      if (error instanceof UsernameTakenError) {
        throw new ConflictException({ code: 'username_taken' });
      }
      if (error instanceof UsernameLockedError) {
        throw new ConflictException({ code: 'username_locked' });
      }
      throw error;
    }
  }

  private toProfile(user: User): PlayerProfile {
    return {
      id: user.id,
      username: user.username,
      locale: user.locale,
      isAdmin: user.isAdmin,
      email: user.email,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      accountUrl: this.config.accountUrl,
    };
  }
}
