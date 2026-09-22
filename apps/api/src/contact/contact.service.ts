import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type ContactMessage as Row } from '@odyssai/db';
import type {
  ContactMessage,
  ContactPage,
  ContactRequest,
} from '@odyssai/schemas';
import { MailService } from '../mail/mail.service.js';
import { PRISMA } from '../prisma/prisma.module.js';

// Une page par defaut, et le plafond d'une page demandee.
const PAGE_SIZE = 25;

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mail: MailService,
  ) {}

  /*
    Enregistre, puis tente l'envoi.

    Dans cet ordre : un serveur de messagerie qui refuse ne doit pas faire
    perdre le message de quelqu'un qui a pris le temps de l'ecrire. L'echec
    d'envoi se lit dans `delivered`, et le tableau de bord montre le message
    de toute facon.
  */
  async submit(request: ContactRequest): Promise<void> {
    const row = await this.prisma.contactMessage.create({
      data: {
        name: request.name?.length ? request.name : null,
        email: request.email,
        subject: request.subject,
        message: request.message,
      },
    });

    const delivered = await this.mail.sendContact({
      name: row.name,
      email: row.email,
      subject: row.subject,
      body: row.message,
    });

    if (!delivered) {
      this.logger.warn(`message de contact non envoye, lisible au tableau de bord : ${row.id}`);
      return;
    }

    // Une ecriture ratee ici ne vaut pas de renvoyer une erreur : le message
    // est enregistre et le courriel est parti, c'est-a-dire l'essentiel. Meme
    // regle que le journal d'usage des modeles.
    await this.prisma.contactMessage
      .update({ where: { id: row.id }, data: { delivered: true } })
      .catch(() => undefined);
  }

  /*
    La liste du tableau de bord, paginee par curseur.

    Par curseur et non par numero de page : elle s'allonge pendant qu'on la
    lit, et un decalage ferait sauter ou repeter des lignes. L'`id` etant un
    uuid v7, l'ordre decroissant suffit.
  */
  async list(cursor?: string, pendingOnly = false): Promise<ContactPage> {
    const rows = await this.prisma.contactMessage.findMany({
      where: pendingOnly ? { handledAt: null } : undefined,
      orderBy: { id: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, PAGE_SIZE);
    const pending = await this.prisma.contactMessage.count({
      where: { handledAt: null },
    });

    return {
      messages: page.map((row) => this.toMessage(row)),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      pending,
    };
  }

  // Bascule : marquer traite, ou rouvrir.
  async setHandled(id: string, handled: boolean): Promise<ContactMessage> {
    const row = await this.prisma.contactMessage.update({
      where: { id },
      data: { handledAt: handled ? new Date() : null },
    });

    return this.toMessage(row);
  }

  private toMessage(row: Row): ContactMessage {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      subject: row.subject,
      message: row.message,
      delivered: row.delivered,
      handledAt: row.handledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
