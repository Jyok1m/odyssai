import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { MailConfig } from '../config/mail-config.js';

/*
  L'envoi de courriels.

  Un seul transporteur, construit une fois : nodemailer garde le pool de
  connexions, et en ouvrir un par message ferait payer une poignee de main TLS
  a chaque fois.

  Aucune methode ne jette. Un courriel perdu est une gene ; une exception
  remontee jusqu'au controleur ferait perdre au visiteur le message qu'il
  vient d'ecrire, alors qu'il est deja enregistre.
*/
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor(private readonly config: MailConfig) {
    this.transporter = config.enabled ? createTransport(config.transport) : null;
  }

  /*
    Rend vrai quand le message est parti.

    `replyTo` porte l'adresse du visiteur et non `from` : expedier sous une
    adresse qu'on ne controle pas ferait echouer SPF et DKIM, et le message
    finirait en indesirable. Repondre reste direct.
  */
  async sendContact(message: {
    name: string | null;
    email: string;
    subject: string;
    body: string;
  }): Promise<boolean> {
    if (!this.transporter) return false;

    const who = message.name ? `${message.name} <${message.email}>` : message.email;

    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        replyTo: message.email,
        subject: `[OdyssAI] ${message.subject}`,
        text: `De : ${who}\n\n${message.body}`,
      });

      return true;
    } catch (error: unknown) {
      this.logger.error(`envoi du message de contact en echec : ${String(error)}`);
      return false;
    }
  }
}
