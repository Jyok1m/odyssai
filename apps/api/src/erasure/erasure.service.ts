import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DepartureOutcome } from '@odyssai/schemas';
import { PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';

/**
 * Ce qui arrive a un monde et a un personnage quand leur joueur s'en va.
 *
 * Deux questions independantes : un personnage peut avoir ete rencontre
 * ailleurs sans que son monde ait jamais recu de visiteur, puisque c'est lui
 * qui voyage. La table `encounters` repond aux deux, et personne n'y ecrit
 * encore : tant que la traversee entre univers n'existe pas, les deux
 * reponses sont non, et tout est supprime. C'est le comportement juste.
 *
 * Un module a part, et non une methode d'OnboardingService : MeController vit
 * dans AuthModule, qu'OnboardingModule importe deja, et l'inverse ferait un
 * cycle.
 */
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Applique la regle au monde du joueur. Ne touche pas a sa ligne `users` :
   * recommencer une partie n'est pas partir.
   */
  async releaseWorld(userId: string): Promise<DepartureOutcome> {
    const universe = await this.prisma.universe.findUnique({
      where: { ownerId: userId },
      include: { character: { select: { id: true } } },
    });

    if (!universe) return { world: 'none', character: 'none' };

    const characterId = universe.character?.id;

    // Le visiteur n'est jamais le proprietaire : on ne se rencontre pas
    // soi-meme, et une visite de son propre monde ne le rend pas partage.
    const [visits, meetings] = await Promise.all([
      this.prisma.encounter.count({
        where: { universeId: universe.id, visitorId: { not: userId } },
      }),
      characterId
        ? this.prisma.encounter.count({
            where: { characterId, visitorId: { not: userId } },
          })
        : Promise.resolve(0),
    ]);

    const worldKept = visits > 0;
    const characterRemembered = meetings > 0;

    // Une seule transaction : un monde a moitie efface serait pire qu'un
    // monde intact.
    await this.prisma.$transaction(async (tx) => {
      if (characterId && characterRemembered) {
        await tx.character.update({
          where: { id: characterId },
          data: { diedAt: new Date() },
        });
      } else if (characterId) {
        // Supprime avant l'univers : sans cela le SetNull le laisserait
        // orphelin au lieu de l'emporter.
        await tx.character.delete({ where: { id: characterId } });
      }

      if (worldKept) {
        // Le monde reste, le joueur non. Ses propres mots partent avec lui :
        // les titres cites, sa description libre et toute la conversation de
        // creation. Ce qui demeure est le monde ecrit par le modele, sans
        // plus rien qui le relie a une personne.
        await tx.conversationMessage.deleteMany({ where: { universeId: universe.id } });
        await tx.generationJob.deleteMany({ where: { universeId: universe.id } });
        await tx.universe.update({
          where: { id: universe.id },
          data: { ownerId: null, works: [], ownDescription: null },
        });
      } else {
        // La cascade emporte messages, travaux et rencontres. Le personnage
        // garde, lui, a deja ete detache par le SetNull.
        await tx.universe.delete({ where: { id: universe.id } });
      }
    });

    const outcome: DepartureOutcome = {
      world: worldKept ? 'kept' : 'deleted',
      character: characterId
        ? characterRemembered
          ? 'remembered'
          : 'deleted'
        : 'none',
    };

    this.logger.log(
      `depart d'un monde : monde ${outcome.world}, personnage ${outcome.character}`,
    );
    return outcome;
  }

  /**
   * Le depart complet. La ligne `users` part apres le monde : la relation est
   * en SetNull, donc la supprimer d'abord laisserait un monde orphelin que
   * plus rien ne saurait rattacher a la regle.
   */
  async eraseAccount(userId: string): Promise<DepartureOutcome> {
    const outcome = await this.releaseWorld(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return outcome;
  }
}
