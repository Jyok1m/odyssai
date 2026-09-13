import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { AppConfig } from '../config/app-config.js';

const HTTP_TIMEOUT_MS = 10_000;

const Discovery = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  end_session_endpoint: z.url().optional(),
  revocation_endpoint: z.url().optional(),
});

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().nonnegative().optional(),
});

export type TokenSet = z.infer<typeof TokenResponse>;

/** Revendications retenues de l'id_token et de l'access token. */
export interface VerifiedIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
}

const IdTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean().default(false),
  nonce: z.string().optional(),
  azp: z.string().optional(),
});

const AccessTokenClaims = z.object({
  realm_access: z.object({ roles: z.array(z.string()) }).optional(),
});

/**
 * Dialogue OpenID Connect avec Keycloak.
 *
 * Le service ne connait que le flot Authorization Code + PKCE : aucun mot de
 * passe ne passe par ici, et le client est confidentiel donc chaque appel au
 * point de jeton est authentifie par le secret.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private discovery?: Promise<z.infer<typeof Discovery>>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {}

  /**
   * Decouverte paresseuse et memorisee : l'API demarre meme si Keycloak est
   * momentanement injoignable, et une decouverte ratee n'est pas mise en cache.
   */
  private metadata(): Promise<z.infer<typeof Discovery>> {
    this.discovery ??= this.fetchMetadata().catch((error: unknown) => {
      this.discovery = undefined;
      throw error;
    });
    return this.discovery;
  }

  private async fetchMetadata(): Promise<z.infer<typeof Discovery>> {
    const url = `${this.config.keycloak.issuer}/.well-known/openid-configuration`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }).catch((error: unknown) => {
      this.logger.error(`decouverte OIDC injoignable : ${String(error)}`);
      throw new ServiceUnavailableException(
        "Le fournisseur d'identite est injoignable",
      );
    });

    if (!response.ok) {
      this.logger.error(
        `decouverte OIDC en echec (HTTP ${response.status}) sur ${url}`,
      );
      throw new ServiceUnavailableException(
        "Le fournisseur d'identite est injoignable",
      );
    }

    const metadata = Discovery.parse(await response.json());

    // Un issuer qui ne correspond pas signale une mauvaise URL de realm : tout
    // le reste de la verification de jeton en depend.
    if (metadata.issuer !== this.config.keycloak.issuer) {
      throw new Error(
        `KEYCLOAK_ISSUER vaut ${this.config.keycloak.issuer} mais le realm annonce ${metadata.issuer}`,
      );
    }

    this.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri));
    return metadata;
  }

  /** URL de la page de connexion Keycloak. */
  async authorizationUrl(params: AuthorizationParams): Promise<string> {
    const { authorization_endpoint } = await this.metadata();
    return this.buildAuthorizeUrl(authorization_endpoint, params);
  }

  /**
   * URL de la page d'inscription Keycloak. Le point n'est pas publie par la
   * decouverte : c'est une extension Keycloak, obtenue en remplacant le
   * segment final du point d'autorisation.
   */
  async registrationUrl(params: AuthorizationParams): Promise<string> {
    const { authorization_endpoint } = await this.metadata();
    return this.buildAuthorizeUrl(
      authorization_endpoint.replace(/\/auth$/, '/registrations'),
      params,
    );
  }

  private buildAuthorizeUrl(
    endpoint: string,
    params: AuthorizationParams,
  ): string {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.keycloak.clientId,
      redirect_uri: this.config.keycloak.redirectUri,
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Echange le code d'autorisation contre les jetons. */
  async exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.keycloak.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  /** Renouvelle les jetons. Le realm fait tourner le refresh a chaque appel. */
  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenSet> {
    const { token_endpoint } = await this.metadata();
    const response = await fetch(token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.basicAuth(),
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Le detail reste dans les journaux : renvoye au navigateur, il
      // indiquerait a un attaquant ou en est sa tentative.
      this.logger.warn(
        `point de jeton en echec (HTTP ${response.status}) : ${await response.text().catch(() => '')}`,
      );
      throw new UnauthorizedException('Authentification refusee');
    }

    return TokenResponse.parse(await response.json());
  }

  /** Revoque un refresh token. Sans effet si le jeton est deja invalide. */
  async revoke(refreshToken: string): Promise<void> {
    const metadata = await this.metadata();
    const endpoint =
      metadata.revocation_endpoint ??
      `${this.config.keycloak.issuer}/protocol/openid-connect/revoke`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.basicAuth(),
      },
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logger.warn(`revocation en echec (HTTP ${response.status})`);
    }
  }

  /** URL de fin de session Keycloak, pour fermer aussi la session SSO. */
  async logoutUrl(idToken: string): Promise<string> {
    const metadata = await this.metadata();
    const endpoint =
      metadata.end_session_endpoint ??
      `${this.config.keycloak.issuer}/protocol/openid-connect/logout`;

    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: this.config.webBaseUrl.toString(),
      client_id: this.config.keycloak.clientId,
    }).toString();
    return url.toString();
  }

  /**
   * Verifie les deux jetons et en extrait l'identite.
   *
   * L'id_token porte l'identite et le nonce, l'access token porte les roles du
   * realm. Les deux sont verifies par signature contre le JWKS du realm : rien
   * n'est lu dans un jeton qui n'a pas ete valide.
   */
  async verifyIdentity(
    tokens: TokenSet,
    expectedNonce: string,
  ): Promise<VerifiedIdentity> {
    const idPayload = await this.verify(tokens.id_token);
    const identity = IdTokenClaims.parse(idPayload);

    if (identity.nonce !== expectedNonce) {
      throw new UnauthorizedException('Nonce invalide');
    }
    // azp designe le client a qui le jeton a ete delivre.
    if (identity.azp && identity.azp !== this.config.keycloak.clientId) {
      throw new UnauthorizedException('Jeton delivre a un autre client');
    }

    const accessPayload = await this.verify(tokens.access_token);
    const access = AccessTokenClaims.parse(accessPayload);

    return {
      sub: identity.sub,
      email: identity.email,
      emailVerified: identity.email_verified,
      roles: access.realm_access?.roles ?? [],
    };
  }

  /** Verifie signature, emetteur et audience d'un jeton du realm. */
  async verify(token: string): Promise<JWTPayload> {
    await this.metadata();
    if (!this.jwks) {
      throw new ServiceUnavailableException(
        "Le fournisseur d'identite est injoignable",
      );
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.keycloak.issuer,
        // Repose sur le mapper d'audience pose par infra/keycloak/setup-realm.sh.
        audience: this.config.keycloak.clientId,
        clockTolerance: 5,
      });
      return payload;
    } catch (error: unknown) {
      this.logger.warn(`jeton rejete : ${String(error)}`);
      throw new UnauthorizedException('Jeton invalide');
    }
  }

  private basicAuth(): string {
    const { clientId, clientSecret } = this.config.keycloak;
    // RFC 6749 section 2.3.1 : les deux valeurs sont encodees en
    // application/x-www-form-urlencoded avant le codage base64.
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }
}

export interface AuthorizationParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}
