import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@odyssai/db';
import { ALPHA_SEATS } from '@odyssai/engine';
import {
  AlphaPhaseSchema,
  type AlphaStatus,
  type UpdateAlphaRequest,
} from '@odyssai/schemas';
import { PRISMA } from '../prisma/prisma.module.js';

/*
  L'etat de l'alpha, annonce et places restantes.

  La phase se choisit au tableau de bord ; « complete » se constate. Un
  administrateur ne doit pas pouvoir annoncer des places qui n'existent plus,
  donc `full` et `remaining` se calculent et ne s'ecrivent nulle part.
*/
@Injectable()
export class AlphaService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async status(): Promise<AlphaStatus> {
    const [settings, taken] = await Promise.all([
      this.settings(),
      // Les administrateurs ne prennent pas de place, comme pour la garde
      // d'inscription et le bonus des premiers arrives.
      this.prisma.user.count({ where: { isAdmin: false } }),
    ]);

    const remaining = Math.max(0, ALPHA_SEATS - taken);

    return {
      phase: settings.phase,
      notice: settings.notice,
      seats: ALPHA_SEATS,
      taken,
      remaining,
      full: remaining === 0,
    };
  }

  /*
    Ouvert ou non, lu a chaque requete de jeu par AlphaOpenGuard : une lecture
    par cle primaire, sans upsert et sans cache, pour la meme raison que les
    paliers. Une ligne absente ou illisible vaut ferme.
  */
  async isOpen(): Promise<boolean> {
    const row = await this.prisma.siteSettings.findUnique({ where: { id: true } });
    return row?.alphaPhase === 'open';
  }

  async update(request: UpdateAlphaRequest): Promise<AlphaStatus> {
    await this.prisma.siteSettings.update({
      where: { id: true },
      data: {
        ...(request.phase !== undefined ? { alphaPhase: request.phase } : {}),
        ...(request.notice !== undefined ? { alphaNotice: request.notice } : {}),
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
  }> {
    const row = await this.prisma.siteSettings.upsert({
      where: { id: true },
      create: {},
      update: {},
    });

    const phase = AlphaPhaseSchema.safeParse(row.alphaPhase);

    return {
      // Une valeur illisible retombe sur la pre-inscription : annoncer une
      // ouverture qu'on n'a pas decidee serait pire que l'inverse.
      phase: phase.success ? phase.data : 'preregistration',
      notice: row.alphaNotice,
    };
  }
}
