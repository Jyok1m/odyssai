import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  UpdateProfileRequestSchema,
  type AccountErasure,
  type PlayerProfile,
} from '@odyssai/schemas';
import { AppConfig } from '../config/app-config.js';
import type { User } from '@odyssai/db';
import {
  UsernameLockedError,
  UsernameTakenError,
  UsersService,
} from '../users/users.service.js';
import { ErasureService } from '../erasure/erasure.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { SessionService } from './session.service.js';
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
    private readonly erasure: ErasureService,
    private readonly sessions: SessionService,
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

  /**
   * Le depart. Efface les donnees de jeu selon la regle, la ligne du joueur,
   * et ferme la session.
   *
   * L'identite reste : elle appartient au realm, et l'api n'a volontairement
   * aucun droit dessus. `accountUrl` mene le joueur la ou il la supprimera
   * lui-meme. Tant qu'il ne l'a pas fait, se reconnecter ici recree un joueur
   * vide, ce que l'ecran doit lui dire.
   */
  @Delete()
  async erase(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountErasure> {
    const outcome = await this.erasure.eraseAccount(user.id);

    // Apres l'effacement : une session detruite d'abord ferait echouer le
    // garde sur la requete en cours.
    const sessionId = this.readCookie(req, this.config.cookies.session);
    if (sessionId) await this.sessions.destroy(sessionId);
    res.clearCookie(this.config.cookies.session, this.cookieOptions());

    return { ...outcome, accountUrl: this.config.accountUrl };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookies.secure,
      sameSite: 'lax',
      path: '/',
    };
  }

  private readCookie(req: Request, name: string): string | undefined {
    const jar = req.cookies as Record<string, unknown> | undefined;
    const value = jar?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
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
