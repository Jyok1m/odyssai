import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Redirect,
  Req,
  Res,
} from '@nestjs/common';
import { InternalPath, type AuthErrorCode, type SessionState } from '@odyssai/schemas';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { AppConfig } from '../config/app-config.js';
import { OidcService } from './oidc.service.js';
import { SessionService, refreshLifetimeSeconds, safeCompare } from './session.service.js';

/**
 * Parametres du retour de Keycloak. Le succes porte code et state, l'echec
 * porte error : les deux formes arrivent sur la meme route.
 */
const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(1024).optional(),
  iss: z.string().max(512).optional(),
});

type Redirection = { url: string; statusCode: number };

/**
 * Authentification en mandataire : le navigateur ne parle jamais a Keycloak
 * autrement que par ses pages de connexion, et ne detient jamais de jeton.
 *
 * signin et signup sont deux redirections vers le meme flot Authorization
 * Code + PKCE, la seconde visant la page d'inscription du realm.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
  ) {}

  @Get('signin')
  @Redirect()
  async signIn(
    @Query('redirect') redirect: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Redirection> {
    return this.beginFlow('signin', redirect, res);
  }

  @Get('signup')
  @Redirect()
  async signUp(
    @Query('redirect') redirect: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Redirection> {
    return this.beginFlow('signup', redirect, res);
  }

  @Get('callback')
  @Redirect()
  async callback(
    @Query() rawQuery: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Redirection> {
    const expectedState = this.readCookie(req, this.config.cookies.transaction);
    res.clearCookie(this.config.cookies.transaction, this.cookieOptions());

    const parsed = CallbackQuery.safeParse(rawQuery);
    if (!parsed.success) return this.failure('invalid_request');
    const query = parsed.data;

    if (query.error) {
      this.logger.warn(`retour Keycloak en erreur : ${query.error} ${query.error_description ?? ''}`);
      return this.failure(query.error === 'access_denied' ? 'access_denied' : 'provider_error');
    }

    // Le state doit avoir ete pose par ce navigateur : sans ce lien, une
    // authentification forcee ferait ouvrir au joueur la session d'un tiers.
    if (!query.code || !query.state || !expectedState || !safeCompare(expectedState, query.state)) {
      return this.failure('invalid_request');
    }

    // RFC 9207 : Keycloak renvoie l'emetteur, on verifie qu'on revient bien
    // du realm attendu et pas d'un fournisseur substitue.
    if (query.iss && query.iss !== this.config.keycloak.issuer) {
      this.logger.warn(`emetteur inattendu au retour : ${query.iss}`);
      return this.failure('invalid_request');
    }

    const transaction = await this.sessions.consumeTransaction(query.state);
    if (!transaction) return this.failure('invalid_request');

    try {
      const tokens = await this.oidc.exchangeCode(query.code, transaction.codeVerifier);
      const identity = await this.oidc.verifyIdentity(tokens, transaction.nonce);
      const sessionId = await this.sessions.create(tokens, identity);

      res.cookie(this.config.cookies.session, sessionId, {
        ...this.cookieOptions(),
        maxAge: refreshLifetimeSeconds(tokens) * 1000,
      });

      return {
        url: new URL(transaction.redirectTo, this.config.webBaseUrl).toString(),
        statusCode: HttpStatus.FOUND,
      };
    } catch (error: unknown) {
      this.logger.error(`ouverture de session en echec : ${String(error)}`);
      return this.failure('session_failed');
    }
  }

  /** Etat d'authentification pour le front. Ne renvoie jamais de jeton. */
  @Get('session')
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionState> {
    const sessionId = this.readCookie(req, this.config.cookies.session);
    if (!sessionId) return { authenticated: false };

    const session = await this.sessions.read(sessionId);
    if (!session) {
      // Session expiree ou revoquee : on retire le cookie devenu inutile.
      res.clearCookie(this.config.cookies.session, this.cookieOptions());
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user: {
        id: session.sub,
        email: session.email,
        emailVerified: session.emailVerified,
        roles: session.roles,
      },
    };
  }

  /**
   * Ferme la session locale et rend l'URL de deconnexion Keycloak, que le
   * front doit suivre pour fermer aussi la session SSO du navigateur.
   *
   * En POST : avec SameSite=Lax le cookie de session ne part pas sur une
   * requete POST venue d'un autre site, ce qui suffit a bloquer la
   * deconnexion forcee.
   */
  @Post('signout')
  @HttpCode(HttpStatus.OK)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ logoutUrl: string }> {
    const sessionId = this.readCookie(req, this.config.cookies.session);
    let logoutUrl = this.config.webBaseUrl.toString();

    if (sessionId) {
      const session = await this.sessions.peek(sessionId);
      await this.sessions.destroy(sessionId);

      if (session) {
        // Une revocation ratee ne doit pas empecher la deconnexion locale :
        // la session Redis, elle, est deja supprimee.
        await this.oidc.revoke(session.refreshToken).catch((error: unknown) => {
          this.logger.warn(`revocation ignoree : ${String(error)}`);
        });
        logoutUrl = await this.oidc.logoutUrl(session.idToken).catch(() => logoutUrl);
      }
    }

    res.clearCookie(this.config.cookies.session, this.cookieOptions());
    return { logoutUrl };
  }

  private async beginFlow(
    kind: 'signin' | 'signup',
    rawRedirect: string | undefined,
    res: Response,
  ): Promise<Redirection> {
    const redirectTo = this.parseRedirect(rawRedirect);
    const { state, nonce, codeChallenge } = await this.sessions.startTransaction(redirectTo);

    // Lie la transaction a ce navigateur. SameSite=Lax et non Strict : en
    // Strict le cookie ne reviendrait pas avec la redirection depuis Keycloak,
    // qui est une navigation venue d'un autre site.
    res.cookie(this.config.cookies.transaction, state, {
      ...this.cookieOptions(),
      maxAge: 600_000,
    });

    const params = { state, nonce, codeChallenge };
    const url =
      kind === 'signin'
        ? await this.oidc.authorizationUrl(params)
        : await this.oidc.registrationUrl(params);

    return { url, statusCode: HttpStatus.FOUND };
  }

  private parseRedirect(raw: string | undefined): string {
    if (raw === undefined) return '/';

    const parsed = InternalPath.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException('Le parametre redirect doit etre un chemin interne');
    }
    return parsed.data;
  }

  private failure(code: AuthErrorCode): Redirection {
    const url = new URL('/', this.config.webBaseUrl);
    url.searchParams.set('auth_error', code);
    return { url: url.toString(), statusCode: HttpStatus.FOUND };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookies.secure,
      sameSite: 'lax',
      // Pas d'attribut domain : le prefixe __Host- l'interdit, et le cookie
      // reste ainsi limite a l'origine exacte de l'API.
      path: '/',
    };
  }

  private readCookie(req: Request, name: string): string | undefined {
    const jar = req.cookies as Record<string, unknown> | undefined;
    const value = jar?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
