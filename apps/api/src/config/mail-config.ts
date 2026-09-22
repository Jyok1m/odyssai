import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

const EnvSchema = z.object({
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Ce que le destinataire lit avant l'adresse.
  SMTP_FROM_NAME: z.string().default('Message @ Odyssai'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  // Ou arrivent les messages du formulaire de contact.
  CONTACT_TO: z.string().default(''),
});

/*
  Tout est facultatif, comme Stripe : sans configuration le contact enregistre
  toujours en base, seul l'envoi se tait.

  Le compte depend de la copie du site, les deux images etant identiques :
  `no-reply-dev@` en developpement, `no-reply@` en production.
*/
@Injectable()
export class MailConfig {
  private readonly logger = new Logger(MailConfig.name);
  private readonly env: z.infer<typeof EnvSchema>;

  constructor() {
    this.env = EnvSchema.parse(process.env);

    if (!this.enabled) {
      this.logger.warn(
        'messagerie absente : les messages de contact seront enregistres sans etre envoyes',
      );
    }
  }

  get enabled(): boolean {
    return (
      this.env.SMTP_HOST.length > 0 &&
      this.env.SMTP_USER.length > 0 &&
      this.env.SMTP_PASSWORD.length > 0 &&
      this.env.CONTACT_TO.length > 0
    );
  }

  get transport() {
    return {
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      // 465 est le port du TLS implicite, 587 celui de STARTTLS, et c'est
      // celui-la que la boite accepte. Le deduire du port evite une variable
      // de plus qui ne pourrait que se contredire.
      secure: this.env.SMTP_PORT === 465,
      // STARTTLS exige, jamais facultatif : sans cela nodemailer accepterait
      // de poursuivre en clair si le serveur ne l'annonce pas.
      requireTLS: this.env.SMTP_PORT !== 465,
      auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD },
    };
  }

  // L'expediteur, et la boite qui recoit.
  get from(): string {
    return `${this.env.SMTP_FROM_NAME} <${this.env.SMTP_USER}>`;
  }

  get to(): string {
    return this.env.CONTACT_TO;
  }
}
