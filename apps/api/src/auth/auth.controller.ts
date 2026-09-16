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
import {
  InternalPath,
  type AuthErrorCode,
  type SessionState,
  type SignOutResult,
  UiLocale,
} from '@odyssai/schemas';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { AppConfig } from '../config/app-config.js';
import { UsersService } from '../users/users.service.js';
import { OidcService } from './oidc.service.js';
import { SessionService, refreshLifetimeSeconds, safeCompare } from './session.service.js';

/** Retour de Keycloak : succes (code, state) et echec (error) sur la meme route. */
const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(1024).optional(),
  iss: z.string().max(512).optional(),
});

type Redirection = { url: string; statusCode: number };

/**
 * Authentification en mandataire : le navigateur ne parle a Keycloak que par
 * ses pages, et ne detient jamais de jeton. signin et signup sont le meme flot
 * Authorization Code + PKCE, la seconde visant la page d'inscription du realm.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Get('signin')
  @Redirect()
  async signIn(
    @Query('redirect') redirect: string | undefined,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Redirection> {
    return this.beginFlow('signin', redirect, locale, res);
  }

  @Get('signup')
  @Redirect()
  async signUp(
    @Query('redirect') redirect: string | undefined,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Redirection> {
    return this.beginFlow('signup', redirect, locale, res);
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

    // RFC 9207 : on revient bien du realm attendu, pas d'un fournisseur substitue.
    if (query.iss && query.iss !== this.config.keycloak.issuer) {
      this.logger.warn(`emetteur inattendu au retour : ${query.iss}`);
      return this.failure('invalid_request');
    }

    const transaction = await this.sessions.consumeTransaction(query.state);
    if (!transaction) return this.failure('invalid_request');

    try {
      const tokens = await this.oidc.exchangeCode(query.code, transaction.codeVerifier);
      const identity = await this.oidc.verifyIdentity(tokens, transaction.nonce);
      // La ligne du joueur nait ici, au premier retour du realm, et son miroir
      // d'identite est rafraichi a chaque passage.
      const user = await this.users.signIn({
        keycloakId: identity.sub,
        email: identity.email,
        emailVerified: identity.emailVerified,
      });
      const sessionId = await this.sessions.create(tokens, identity, user.id);

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

  /** Ne renvoie jamais de jeton. */
  @Get('session')
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionState> {
    const sessionId = this.readCookie(req, this.config.cookies.session);
    if (!sessionId) return { authenticated: false };

    const session = await this.sessions.read(sessionId);
    if (!session) {
      // Session expiree ou revoquee : cookie devenu inutile.
      res.clearCookie(this.config.cookies.session, this.cookieOptions());
      return { authenticated: false };
    }

    // Les sessions ouvertes avant le provisionnement ne portent pas d'id
    // applicatif : on le resout une fois plutot que de renvoyer le sub, que le
    // front ne doit jamais confondre avec l'identifiant de la ligne.
    const userId =
      session.userId ??
      (
        await this.users.resolve({
          keycloakId: session.sub,
          email: session.email,
          emailVerified: session.emailVerified,
        })
      ).id;

    return {
      authenticated: true,
      user: {
        id: userId,
        email: session.email,
        emailVerified: session.emailVerified,
        roles: session.roles,
      },
    };
  }

  /**
   * Rend l'URL de fin de session du realm, que le front doit suivre pour
   * fermer aussi la session SSO. En POST : avec SameSite=Lax le cookie ne part
   * pas sur un POST venu d'un autre site, ce qui bloque la deconnexion forcee.
   */
  @Post('signout')
  @HttpCode(HttpStatus.OK)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignOutResult> {
    const sessionId = this.readCookie(req, this.config.cookies.session);
    let logoutUrl = this.config.webBaseUrl.toString();

    if (sessionId) {
      const session = await this.sessions.peek(sessionId);
      await this.sessions.destroy(sessionId);

      if (session) {
        // Une revocation ratee n'empeche pas la deconnexion : la cle Redis
        // est deja supprimee.
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
    rawLocale: string | undefined,
    res: Response,
  ): Promise<Redirection> {
    const redirectTo = this.parseRedirect(rawRedirect);
    // Langue inconnue ignoree : Keycloak sert alors celle du realm.
    const uiLocale = UiLocale.safeParse(rawLocale).data;
    const { state, nonce, codeChallenge } = await this.sessions.startTransaction(redirectTo);

    // Lie la transaction a ce navigateur. Lax et non Strict : en Strict le
    // cookie ne reviendrait pas avec la redirection depuis Keycloak.
    res.cookie(this.config.cookies.transaction, state, {
      ...this.cookieOptions(),
      maxAge: 600_000,
    });

    const params = { state, nonce, codeChallenge, uiLocale };
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
      // Pas d'attribut domain : __Host- l'interdit et borne le cookie a
      // l'origine exacte de l'API.
      path: '/',
    };
  }

  private readCookie(req: Request, name: string): string | undefined {
    const jar = req.cookies as Record<string, unknown> | undefined;
    const value = jar?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
