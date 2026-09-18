/**
 * Un envoi reel, pour verifier que la messagerie tient debout.
 *
 *   pnpm --filter @odyssai/api build
 *   node apps/api/scripts/mail-smoke.ts
 *
 * Aucun mot de passe n'atteint la sortie standard, seulement le resultat.
 */
import { loadRootEnvFile } from '@odyssai/db';
import { MailConfig } from '../dist/config/mail-config.js';
import { MailService } from '../dist/mail/mail.service.js';

loadRootEnvFile(new URL('..', import.meta.url).pathname);

const config = new MailConfig();
if (!config.enabled) {
  console.error('messagerie non configuree : SMTP_HOST, SMTP_USER, SMTP_PASSWORD et CONTACT_TO sont requis');
  process.exit(1);
}

console.log(`serveur      ${config.transport.host}:${config.transport.port}`);
console.log(`secure       ${config.transport.secure}`);
console.log(`expediteur   ${config.from}`);
console.log(`destinataire ${config.to}`);

const sent = await new MailService(config).sendContact({
  name: 'Controle',
  email: config.to,
  subject: 'controle de la messagerie',
  body: "Si tu lis ceci, le formulaire de contact sait envoyer.",
});

console.log(sent ? 'envoye' : 'refuse, voir le journal ci-dessus');
process.exit(sent ? 0 : 1);
