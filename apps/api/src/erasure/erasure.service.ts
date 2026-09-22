import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import type { DepartureOutcome } from '@odyssai/schemas';
import { PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { STRIPE } from '../stripe/stripe.module.js';

/*
  Ce qui arrive a un monde et a un personnage quand leur joueur s'en va.

  Deux questions independantes : un personnage voyage, donc il peut avoir ete
  rencontre sans que son monde ait recu personne. Rien n'ecrit encore dans
  `encounters`, donc les deux reponses sont non et tout est supprime.

  Un module a part : `MeController` vit dans `AuthModule`, qu'`OnboardingModule`
  importe deja, et l'inverse ferait un cycle.
*/
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    // Le client vient de StripeModule, qui est global : passer par
    // BillingService ferait Auth vers Erasure vers Billing vers Auth, et un
    // forwardRef pour une seule ligne d'annulation se paierait cher.
    @Inject(STRIPE) private readonly stripe: Stripe | null,
  ) {}

  /*
    Applique la regle au monde du joueur. Ne touche pas a sa ligne `users` :
    recommencer une partie n'est pas partir.
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
        /*
          Le monde reste, le joueur non : ses titres cites, sa description
          libre et la conversation de creation partent avec lui. Ce qui demeure
          est le texte du modele, sans lien avec une personne.
        */
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

  /*
    Le depart complet. La ligne `users` part apres le monde : la relation est
    en SetNull, donc la supprimer d'abord laisserait un monde orphelin que
    plus rien ne saurait rattacher a la regle.
  */
  async eraseAccount(userId: string): Promise<DepartureOutcome> {
    await this.endBilling(userId);
    const outcome = await this.releaseWorld(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return outcome;
  }

  /*
    Avant la suppression : `subscriptions` est en cascade sur `users`, donc
    effacer d'abord emporterait l'identifiant Stripe et le joueur resterait
    preleve. Immediatement et sans remboursement, personne ne restant pour
    profiter de la periode. Un echec n'arrete pas le depart : il part dans les
    journaux, avec l'identifiant, pour etre rattrape a la main. Le client
    Stripe reste, ses factures devant survivre au compte.
  */
  private async endBilling(userId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      select: { stripeSubscriptionId: true },
    });

    const stripeSubscriptionId = subscription?.stripeSubscriptionId;
    if (!stripeSubscriptionId) return;

    if (!this.stripe) {
      this.logger.error(
        `abonnement non resilie, aucune cle Stripe configuree : ${stripeSubscriptionId}`,
      );
      return;
    }

    try {
      await this.stripe.subscriptions.cancel(stripeSubscriptionId);
      this.logger.log(`abonnement resilie au depart : ${stripeSubscriptionId}`);
    } catch (error: unknown) {
      this.logger.error(
        `abonnement NON resilie au depart de ${userId}, a reprendre a la main : ${stripeSubscriptionId}`,
        error,
      );
    }
  }
}
