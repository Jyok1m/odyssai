import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { CreditsService } from '../credits/credits.service.js';

// Le motif sous lequel la generation d'un monde se debite au grand livre.
const REASON = 'worldGeneration';

/*
  Rendre les credits d'une generation qui n'a pas abouti.

  Une generation qui echoue ne doit rien couter : le joueur n'a pas eu son
  monde. Tous les autres appels de modele remboursent deja, celui-la ne le
  faisait pas, et il est le plus cher des cinq : vingt-cinq credits perdus
  par echec, et vingt-cinq de plus a chaque relance.

  Dans une table, chacun a paye sa part : il y a autant de debits que de
  sieges, et chacun se rembourse comme il s'etait debite.

  Le remboursement se declenche a la lecture, la ou la panne se constate : le
  flux d'avancement qui la sert, et la relecture du parcours qui trouve l'etape
  `failed`. Le worker, lui, ne touche pas au grand livre : y recopier une
  ecriture comptable en ferait une seconde definition.

  Deux lecteurs peuvent donc arriver ensemble. C'est `refunded_at` qui tranche,
  par une ecriture conditionnelle : un seul la pose, un seul rembourse.

  Celui qui la pose rouvre aussi la table : chaque siege redevient non pret,
  et devra repayer sa part pour relancer. Sans cela, les sieges restaient
  prets sur une part rendue, et le premier a relancer relancait pour tous.
*/
@Injectable()
export class GenerationRefundService {
  private readonly logger = new Logger(GenerationRefundService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly credits: CreditsService,
  ) {}

  async settle(universeId: string): Promise<void> {
    const failed = await this.prisma.generationJob.findMany({
      where: { universeId, status: 'failed', refundedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });
    if (failed.length === 0) return;

    for (const job of failed) {
      /*
        Le verrou : qui pose la date rembourse, les autres passent. Sans
        cela, deux lectures concurrentes crediteraient deux fois.
      */
      const claimed = await this.prisma.generationJob.updateMany({
        where: { id: job.id, refundedAt: null },
        data: { refundedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      await this.reopen(universeId);

      // Tous les debits non rendus de ce travail, un par siege dans une table.
      const entries = await this.pending(universeId, job.createdAt);
      if (entries.length === 0) {
        /*
          Rien a rendre : un administrateur ne consomme rien, donc rien ne
          s'est ecrit au grand livre. La date reste posee, la question est
          close.
        */
        continue;
      }

      for (const entry of entries) {
        await this.credits.refund(entry);
      }
      this.logger.log(
        `generation ${universeId} remboursee apres echec (${entries.length} part(s))`,
      );
    }
  }

  // Dans une table, chaque siege redevient non pret : sa part vient d'etre rendue.
  private async reopen(universeId: string): Promise<void> {
    const party = await this.prisma.party.findUnique({
      where: { universeId },
      select: { id: true },
    });
    if (!party) return;

    await this.prisma.partyMember.updateMany({
      where: { partyId: party.id },
      data: { ready: false },
    });
  }

  /*
    Les debits qui n'ont pas encore ete rendus, le plus ancien d'abord.

    C'est le grand livre qui repond, et non un compteur a cote : il est en
    ajout seul, un remboursement y porte l'identifiant du debit qu'il annule,
    et la question « lesquels restent-ils a rendre » se lit donc dedans.

    Seulement ceux d'avant le travail rate : une part repayee depuis, pour la
    relance, n'appartient pas a cet echec, et la rendre laisserait jouer
    quelqu'un qui n'a rien paye.
  */
  private async pending(universeId: string, before: Date): Promise<string[]> {
    const debits = await this.prisma.creditEntry.findMany({
      where: {
        ref: universeId,
        reason: REASON,
        delta: { lt: 0 },
        // Au plus tard avec lui : la derniere part et le travail peuvent
        // tomber dans la meme milliseconde, une relance jamais.
        createdAt: { lte: before },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (debits.length === 0) return [];

    const returned = new Set(
      (
        await this.prisma.creditEntry.findMany({
          where: { reason: 'refund', ref: { in: debits.map((row) => row.id) } },
          select: { ref: true },
        })
      ).map((row) => row.ref),
    );

    return debits.filter((row) => !returned.has(row.id)).map((row) => row.id);
  }
}
