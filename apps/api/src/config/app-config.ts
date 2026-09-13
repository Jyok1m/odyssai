import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  API_BASE_URL: z.url(),
  WEB_BASE_URL: z.url(),

  KEYCLOAK_ISSUER: z.url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),

  REDIS_URL: z.url(),
});

type Env = z.infer<typeof EnvSchema>;

/**
 * Configuration validee au demarrage : une variable manquante fait echouer le
 * bootstrap plutot que la premiere connexion d'un joueur.
 */
@Injectable()
export class AppConfig {
  private readonly env: Env;
  readonly apiBaseUrl: URL;
  readonly webBaseUrl: URL;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
        .join('\n');
      throw new Error(`Configuration invalide, voir .env.example :\n${details}`);
    }

    this.env = parsed.data;
    this.apiBaseUrl = new URL(this.env.API_BASE_URL);
    this.webBaseUrl = new URL(this.env.WEB_BASE_URL);

    if (this.isProduction && !this.cookieSecure) {
      throw new Error('API_BASE_URL doit etre en https en production : la session voyage en clair sinon.');
    }
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get port(): number {
    return this.env.PORT;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get keycloak() {
    return {
      // Sans barre finale : le point de decouverte se construit par
      // concatenation et Keycloak refuse une double barre.
      issuer: this.env.KEYCLOAK_ISSUER.replace(/\/+$/, ''),
      clientId: this.env.KEYCLOAK_CLIENT_ID,
      clientSecret: this.env.KEYCLOAK_CLIENT_SECRET,
      redirectUri: new URL('/auth/callback', this.apiBaseUrl).toString(),
    };
  }

  /**
   * Les cookies ne sont Secure que si l'API est servie en https. En http local
   * le prefixe __Host- est retire : il impose Secure, et Safari refuse un
   * cookie Secure sur http://localhost, ce qui casserait le flot en dev.
   */
  get cookieSecure(): boolean {
    return this.apiBaseUrl.protocol === 'https:';
  }

  get cookies() {
    const prefix = this.cookieSecure ? '__Host-' : '';
    return {
      secure: this.cookieSecure,
      session: `${prefix}odyssai_session`,
      transaction: `${prefix}odyssai_tx`,
    };
  }
}
