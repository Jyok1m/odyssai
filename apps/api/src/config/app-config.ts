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
  POSTGRES_URL: z.url(),
});

type Env = z.infer<typeof EnvSchema>;

/*
  Validee au demarrage : une variable manquante casse le bootstrap, pas la
  premiere connexion d'un joueur.
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

  get postgresUrl(): string {
    return this.env.POSTGRES_URL;
  }

  get keycloak() {
    return {
      // Sans barre finale : la decouverte se construit par concatenation.
      issuer: this.env.KEYCLOAK_ISSUER.replace(/\/+$/, ''),
      clientId: this.env.KEYCLOAK_CLIENT_ID,
      clientSecret: this.env.KEYCLOAK_CLIENT_SECRET,
      redirectUri: new URL('/auth/callback', this.apiBaseUrl).toString(),
    };
  }

  /*
    Console de compte du realm. `referrer` doit nommer un client existant :
    c'est ce qui donne au joueur un retour vers le site depuis les pages de
    Keycloak, sans quoi il s'y retrouve enferme.
  */
  get accountUrl(): string {
    const url = new URL(`${this.keycloak.issuer}/account`);
    /*
      `referrer` seul, sans `referrer_uri` : Keycloak valide ce dernier contre
      les redirectUris du client, ou l'origine du web ne figure pas, et laisse
      alors tomber le lien de retour en silence.
    */
    url.searchParams.set('referrer', this.env.KEYCLOAK_CLIENT_ID);
    return url.toString();
  }

  /*
    En http local le prefixe __Host- est retire : il impose Secure, et Safari
    refuse un cookie Secure sur http://localhost.
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
      guidePass: `${prefix}odyssai_guide_pass`,
    };
  }
}
