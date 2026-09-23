import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@odyssai/db';
import { FOUNDER_BONUS } from '@odyssai/engine';
import {
  AlphaPhaseSchema,
  type AlphaStatus,
  type UpdateAlphaRequest,
} from '@odyssai/schemas';
import { PRISMA } from '../prisma/prisma.module.js';

/*
  L'etat de l'alpha : ouverte ou fermee, ce qu'on annonce, si les paliers se
  vendent, et ou en sont les premiers inscrits.

  Les premiers inscrits ne sont plus une porte : le bonus est un cadeau aux
  cent premiers, et le cent unieme entre quand meme. Le compte se lit, il ne
  s'ecrit nulle part.
*/
@Injectable()
export class AlphaService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async status(): Promise<AlphaStatus> {
    const [settings, taken] = await Promise.all([
      this.settings(),
      // Les administrateurs ne comptent pas, comme pour le bonus lui-meme.
      this.prisma.user.count({ where: { isAdmin: false } }),
    ]);

    return {
      phase: settings.phase,
      notice: settings.notice,
      salesOpen: settings.salesOpen,
      founders: {
        seats: FOUNDER_BONUS.rank,
        credits: FOUNDER_BONUS.credits,
        taken: Math.min(taken, FOUNDER_BONUS.rank),
        remaining: Math.max(0, FOUNDER_BONUS.rank - taken),
      },
    };
  }

  /*
    Ouvert ou non, lu a chaque requete de jeu par AlphaOpenGuard : une lecture
    par cle primaire, sans upsert et sans cache, pour la meme raison que les
    paliers. Une ligne absente ou illisible vaut ferme.

    `findFirst` et non `findUnique` : Prisma regroupe les `findUnique`
    concurrents d'un meme tick en un seul `findMany` sur `id: { in: [...] }`,
    et un filtre booleen ne connait pas `in`. Deux requetes de jeu arrivees
    ensemble (la page des histoires en fait deux) tombaient en 500 sur
    « Unknown argument in ». `alpha.service.spec.ts` le rejoue sur le vrai
    client.
  */
  async isOpen(): Promise<boolean> {
    const row = await this.prisma.siteSettings.findFirst({
      where: { id: true },
    });
    return row?.alphaPhase === 'open';
  }

  // La vente, lue au catalogue et a l'achat. Absente, fermee. `findFirst`
  // pour la raison dite sur `isOpen`.
  async salesOpen(): Promise<boolean> {
    const row = await this.prisma.siteSettings.findFirst({
      where: { id: true },
    });
    return row?.salesOpen === true;
  }

  async update(request: UpdateAlphaRequest): Promise<AlphaStatus> {
    await this.prisma.siteSettings.update({
      where: { id: true },
      data: {
        ...(request.phase !== undefined ? { alphaPhase: request.phase } : {}),
        ...(request.notice !== undefined
          ? { alphaNotice: request.notice }
          : {}),
        ...(request.salesOpen !== undefined
          ? { salesOpen: request.salesOpen }
          : {}),
      },
    });

    return this.status();
  }

  /*
    La ligne unique, creee au besoin.

    La migration en pose une, mais une base restauree d'un dump partiel ou un
    environnement monte a la main n'en aurait pas, et le site entier tomberait
    pour un reglage d'affichage.
  */
  private async settings(): Promise<{
    phase: AlphaStatus['phase'];
    notice: boolean;
    salesOpen: boolean;
  }> {
    const row = await this.prisma.siteSettings.upsert({
      where: { id: true },
      create: {},
      update: {},
    });

    const phase = AlphaPhaseSchema.safeParse(row.alphaPhase);

    return {
      // Une valeur illisible vaut ferme : ouvrir sans l'avoir decide serait
      // pire que l'inverse.
      phase: phase.success ? phase.data : 'preregistration',
      notice: row.alphaNotice,
      salesOpen: row.salesOpen,
    };
  }
}
