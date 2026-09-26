import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import Stripe from 'stripe';
import type { DepartureOutcome } from '@odyssai/schemas';
import { Prisma, PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { STRIPE } from '../stripe/stripe.module.js';
import { CreditsService } from '../credits/credits.service.js';
import { openStoryWhere } from '../stories/stories.service.js';
import { pendingRollKey } from '../turn/pending-roll.service.js';

// Le canal de creation, dont le fil part avec celui qui l'a ecrit.
const CREATION_CHANNEL = 'character_creation';

// Le journal du jeu, qui reste au groupe quand un joueur part.
const GAME_CHANNEL = 'game_turn';

/*
  Les etapes ou partir rend sa part : le monde n'existe pas encore, ou sa
  generation a rate. Pendant `generating`, il est en train de naitre pour
  lui aussi, et apres, il existe parce qu'il en etait.
*/
const REFUNDABLE_STEPS = ['inspiration', 'character', 'failed'];

// Le motif sous lequel une part de monde se debite au grand livre.
const WORLD_REASON = 'worldGeneration';

/*
  Ce que la lecture d'une histoire de partie embarque : la table et ses
  sieges, pour savoir qui reste quand quelqu'un part.
 */
const WITH_PARTY = {
  party: { include: { members: { orderBy: { joinedAt: 'asc' as const } } } },
} as const satisfies Prisma.UniverseInclude;

type WithParty = Prisma.UniverseGetPayload<{ include: typeof WITH_PARTY }>;

// Le personnage du joueur qui part, et rien d'autre.
const WITH_CHARACTER = (userId: string) => ({
  party: { include: { members: { orderBy: { joinedAt: 'asc' as const } } } },
  characters: { where: { ownerId: userId }, select: { id: true, essenceId: true } },
}) as const;

/*
  Ce qui arrive a un monde et a un personnage quand leur joueur s'en va.

  Deux questions independantes : un personnage voyage, donc il peut avoir ete
  rencontre sans que son monde ait recu personne. Rien n'ecrit encore dans
  `encounters`, donc les deux reponses sont non et tout est supprime.

  Une histoire jouee a plusieurs suit une troisieme regle : on ne supprime pas
  une table ou d'autres sont encore assis. Celui qui part laisse son siege,
  son personnage survit avec sa tombe (le groupe l'a croise, et davantage),
  et l'appartenance du monde passe au membre le plus ancien reste en place.
  Le dernier sortant applique la regle ordinaire au monde.

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
    // Pour faire tomber ce que le partant attendait d'un jet : une action
    // en attente n'a plus de scene a se poser.
    @Inject(REDIS) private readonly redis: Redis,
    // Pour rendre sa part a qui partit avant que le monde existe :
    // CreditsModule est global, et le grand livre est le seul juge.
    private readonly credits: CreditsService,
  ) {}

  /*
    Applique la regle a l'histoire ouverte du joueur, et a elle seule : ses
    autres histoires restent. Ne touche pas a sa ligne `users` : recommencer
    une partie n'est pas partir.
  */
  async releaseWorld(
    user: Pick<User, 'id' | 'currentUniverseId'>,
  ): Promise<DepartureOutcome> {
    const where = openStoryWhere(user);
    const universe = where
      ? await this.prisma.universe.findFirst({
          where,
          include: WITH_CHARACTER(user.id),
        })
      : null;

    if (!universe) return { world: 'none', character: 'none' };
    return this.departOrRelease(user.id, universe);
  }

  /*
    La meme regle pour une histoire designee, ouverte ou non. Celle d'un
    autre joueur n'est pas trouvee, donc rien ne part : la sienne, ou celle
    de sa table.
  */
  async releaseStory(userId: string, universeId: string): Promise<DepartureOutcome> {
    const universe = await this.prisma.universe.findFirst({
      where: {
        id: universeId,
        OR: [
          { ownerId: userId },
          { party: { members: { some: { userId } } } },
        ],
      },
      include: WITH_CHARACTER(userId),
    });

    if (!universe) return { world: 'none', character: 'none' };
    return this.departOrRelease(userId, universe);
  }

  /*
    Quitter la table ou le joueur siege, ouverte ou non. Ce n'est pas
    effacer une histoire : c'est partir de celle des autres.
  */
  async releaseMembership(userId: string): Promise<DepartureOutcome> {
    const seat = await this.prisma.partyMember.findUnique({
      where: { userId },
      select: { partyId: true },
    });
    if (!seat) return { world: 'none', character: 'none' };

    const universe = await this.prisma.universe.findUnique({
      where: { id: await this.universeOf(seat.partyId) },
      include: WITH_CHARACTER(userId),
    });
    if (!universe) return { world: 'none', character: 'none' };

    return this.departOrRelease(userId, universe);
  }

  private async universeOf(partyId: string): Promise<string> {
    const party = await this.prisma.party.findUniqueOrThrow({
      where: { id: partyId },
      select: { universeId: true },
    });
    return party.universeId;
  }

  /*
    Une histoire de partie se quitte, une histoire solo se supprime. La
    difference se lit sur la table, pas sur l'appartenance : le monde d'une
    table peut avoir change de main.
  */
  private departOrRelease(
    userId: string,
    universe: WithParty & {
      characters: { id: string; essenceId: string | null }[];
    },
    erasing = false,
  ): Promise<DepartureOutcome> {
    return universe.party
      ? this.depart(userId, universe, erasing)
      : this.release(userId, universe);
  }

  /*
    Quitter une table.

    Son siege part, son fil de creation part avec lui, son personnage prend
    sa tombe : le groupe l'a rencontre, les recits qui le croisent doivent
    pouvoir le dire mort plutot que le faire disparaitre. Ses messages du
    jeu restent : une histoire de groupe appartient au groupe, et en couper
    des lignes dechirerait chaque scene ou le meneur lui avait repondu.

    D'autres restent : le monde leur survit, et l'appartenance passe au plus
    ancien d'entre eux si c'etait le departing qui l'hebergeait. Personne ne
    reste : la regle ordinaire decide du sort du monde.
  */
  /*
    La part que ce joueur a payee pour ce monde et qui n'a pas encore ete
    rendue.

    Toutes les parts d'une table portent le meme ref, l'univers : c'est
    l'abonnement qui distingue qui a paye quoi, chaque ecriture portant celui
    du joueur qui l'a ecrite. Sans ce filtre, rendre sa part au partant
    rendrait aussi celles de ses compagnons de table.

    Le grand livre reste le seul juge : une part se rembourse comme elle
    s'etait debitee, par l'identifiant de son ecriture.
  */
  private async refundShare(userId: string, universeId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!subscription) return;

    const entries = await this.prisma.creditEntry.findMany({
      where: {
        subscriptionId: subscription.id,
        reason: WORLD_REASON,
        delta: { lt: 0 },
        ref: universeId,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (entries.length === 0) return;

    const returned = new Set(
      (
        await this.prisma.creditEntry.findMany({
          where: { reason: 'refund', ref: { in: entries.map((row) => row.id) } },
          select: { ref: true },
        })
      ).map((row) => row.ref),
    );

    for (const entry of entries) {
      if (returned.has(entry.id)) continue;
      await this.credits.refund(entry.id);
    }
  }

  /*
    `erasing` : le compte part, pas seulement le siege. Son personnage ne
    reste alors que si quelqu'un d'autre l'a croise hors de la table, comme
    en solo : sa fiche est ce qu'il a ecrit, et le groupe garde le recit du
    meneur, pas la fiche.
  */
  private async depart(
    userId: string,
    universe: WithParty & {
      characters: { id: string; essenceId: string | null }[];
      step: string;
    },
    erasing = false,
  ): Promise<DepartureOutcome> {
    // Ce qui attendait un jet n'a plus de scene : la partie avance sans lui.
    await this.redis.del(pendingRollKey(userId));

    const character = universe.characters[0] ?? null;
    const partyId = universe.party!.id;
    const others = universe.party!.members.filter(
      (member) => member.userId !== userId,
    );

    /*
      Partir avant que le monde existe rend sa part : rien n'a ete genere
      pour lui. Apres, la part est due : le monde existe parce qu'il en
      etait, et les autres y jouent.

      Seulement pour qui a vraiment quitte son siege : c'est la suppression
      de la ligne qui designe le partant, et deux departs simultanes n'en
      suppriment qu'une. Rendre avant, sur une lecture du grand livre, rendait
      deux fois.
    */
    const refund = REFUNDABLE_STEPS.includes(universe.step);

    if (others.length === 0) {
      const left = await this.prisma.partyMember.deleteMany({
        where: { partyId, userId },
      });
      if (left.count === 0) return { world: 'none', character: 'none' };

      if (refund) await this.refundShare(userId, universe.id);
      this.logger.log(`dernier joueur sorti : la table ${partyId} se ferme`);
      const outcome = await this.release(userId, universe);

      /*
        Un monde garde n'est plus une table : sa ligne et son code partent.
        Un monde supprime les a deja emportes en cascade.
      */
      await this.prisma.party.deleteMany({ where: { id: partyId } });
      return outcome;
    }

    // Garde seulement si quelqu'un d'autre l'a croise, a l'effacement du compte.
    const met =
      character && erasing
        ? (await this.prisma.encounter.count({
            where: { characterId: character.id, visitorId: { not: userId } },
          })) > 0
        : true;

    const senior = others[0]!;
    const left = await this.prisma.$transaction(async (tx) => {
      const seat = await tx.partyMember.deleteMany({ where: { partyId, userId } });
      if (seat.count === 0) return false;

      // Son fil de creation part.
      await tx.conversationMessage.deleteMany({
        where: { universeId: universe.id, channel: CREATION_CHANNEL, memberId: userId },
      });
      /*
        Ses mots au journal du jeu partent aussi, leur rang reste : les
        reponses du meneur autour se lisent toujours dans l'ordre, et le
        message vide dit qu'un joueur a parle ici. Les laisser mot pour mot
        contredisait la regle du depart, qui vide le monde de ce que le
        joueur a ecrit.
      */
      await tx.conversationMessage.updateMany({
        where: { universeId: universe.id, channel: GAME_CHANNEL, role: 'user', memberId: userId },
        data: { content: '' },
      });
      if (character && met) {
        await tx.character.update({
          where: { id: character.id },
          data: { diedAt: new Date() },
        });
      } else if (character) {
        await tx.character.delete({ where: { id: character.id } });
      }
      // L'hote part : le monde reste a la table, et quelqu'un doit l'heberger.
      if (universe.ownerId === userId) {
        await tx.universe.update({
          where: { id: universe.id },
          data: { ownerId: senior.userId },
        });
      }
      // Le pointeur du partant ne vise plus rien de vrai : il repart sur une
      // histoire a commencer, les autres restent a portee.
      await tx.user.updateMany({
        where: { id: userId, currentUniverseId: universe.id },
        data: { currentUniverseId: null },
      });
      return true;
    });
    if (!left) return { world: 'none', character: 'none' };

    if (refund) await this.refundShare(userId, universe.id);

    this.logger.log(
      `depart d une table : monde ${universe.id} ${
        universe.ownerId === userId ? `transfere a ${senior.userId}` : 'garde par son hote'
      }`,
    );

    return {
      world: 'kept',
      character: character ? (met ? 'remembered' : 'deleted') : 'none',
    };
  }

  private async release(
    userId: string,
    universe: { id: string; characters: { id: string; essenceId: string | null }[] },
  ): Promise<DepartureOutcome> {
    const character = universe.characters[0] ?? null;
    const characterId = character?.id ?? null;
    const essenceId = character?.essenceId ?? null;

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

    /*
      Les autres personnages du monde : ceux des joueurs deja partis d'une
      table, restes avec leur tombe. Le dernier sortant leur applique la
      regle du solo, gardes seulement si un visiteur les a croises : sans
      cela ils survivaient orphelins, fiche et personnalite ecrites par leur
      joueur comprises, a un monde supprime. Leur essence reste a leur
      joueur, elle n'est pas a celui qui part. Aucun en solo.
    */
    const tombs = (
      await this.prisma.character.findMany({
        where: { universeId: universe.id },
        select: { id: true, ownerId: true },
      })
    ).filter((row) => row.id !== characterId);
    const forgotten: string[] = [];
    for (const tomb of tombs) {
      const seen = await this.prisma.encounter.count({
        where: {
          characterId: tomb.id,
          ...(tomb.ownerId ? { visitorId: { not: tomb.ownerId } } : {}),
        },
      });
      if (seen === 0) forgotten.push(tomb.id);
    }

    // Une seule transaction : un monde a moitie efface serait pire qu'un
    // monde intact.
    await this.prisma.$transaction(async (tx) => {
      for (const id of forgotten) {
        await tx.character.delete({ where: { id } });
      }

      if (characterId && characterRemembered) {
        await tx.character.update({
          where: { id: characterId },
          data: { diedAt: new Date() },
        });
      } else if (characterId) {
        // Supprime avant l'univers : sans cela le SetNull le laisserait
        // orphelin au lieu de l'emporter.
        await tx.character.delete({ where: { id: characterId } });

        /*
          L'essence suit sa derniere incarnation. Recommencer doit rendre la
          page blanche : la garder ferait reapparaitre un personnage dont le
          monde n'existe plus dans la liste de ceux qu'on peut amener.

          Un personnage garde parce que d'autres l'ont croise, lui, conserve
          la sienne : c'est le cas au-dessus, et il n'est pas supprime.
        */
        if (essenceId) {
          const left = await tx.character.count({ where: { essenceId } });
          if (left === 0) await tx.essence.delete({ where: { id: essenceId } });
        }
      }

      if (worldKept) {
        /*
          Le monde reste, le joueur non : ses titres cites, sa description
          libre et la conversation de creation partent avec lui. Ce qui demeure
          est le texte du modele, sans lien avec une personne.

          Dans une histoire de partie, le fil de creation du partant part
          aussi : il etait a lui seul. Le journal du jeu, lui, reste : il
          appartient au groupe.
        */
        await tx.conversationMessage.deleteMany({ where: { universeId: universe.id } });
        await tx.generationJob.deleteMany({ where: { universeId: universe.id } });
        await tx.universe.update({
          where: { id: universe.id },
          data: { ownerId: null, works: [], ownDescription: null },
        });
        // Un monde detache n'est plus une histoire ouverte. Un monde supprime,
        // lui, est retire du pointeur par la base (SetNull).
        await tx.user.updateMany({
          where: { id: userId, currentUniverseId: universe.id },
          data: { currentUniverseId: null },
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
    Le depart complet : toutes les histoires du joueur, l'ouverte comme les
    autres, et les tables ou il siege. La ligne `users` part apres les
    mondes : la relation est en SetNull, donc la supprimer d'abord
    laisserait des mondes orphelins que plus rien ne saurait rattacher a la
    regle.
  */
  async eraseAccount(userId: string): Promise<DepartureOutcome> {
    await this.endBilling(userId);

    // Ses sieges d'abord : chaque table doit savoir qu'il part, et les
    // mondes qu'il n'heberge pas ne passeront pas par la boucle des siens.
    const seats = await this.prisma.partyMember.findMany({
      where: { userId },
      select: { partyId: true },
    });

    const outcomes: DepartureOutcome[] = [];
    for (const seat of seats) {
      const universe = await this.prisma.universe.findUnique({
        where: { id: await this.universeOf(seat.partyId) },
        include: WITH_CHARACTER(userId),
      });
      if (universe) outcomes.push(await this.depart(userId, universe, true));
    }

    const universes = await this.prisma.universe.findMany({
      where: { ownerId: userId },
      include: WITH_CHARACTER(userId),
    });

    for (const universe of universes) {
      outcomes.push(await this.departOrRelease(userId, universe, true));
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return merge(outcomes);
  }

  /*
    Avant la suppression : `subscriptions` est en cascade sur `users`, donc
    effacer d'abord emporterait l'identifiant Stripe et le joueur resterait
    preleve. Immediatement et sans remboursement, personne ne restant pour
    profiter de la periode. Un echec n'arrete pas le depart : il part dans
    les journaux, avec l'identifiant, pour etre rattrape a la main. Le client
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

/*
  Le sort de plusieurs mondes en un seul : ce qui a ete garde prime sur
  ce qui a ete supprime, parce que c'est ce que le joueur doit savoir.
*/
function merge(outcomes: DepartureOutcome[]): DepartureOutcome {
  const worlds = outcomes.map((outcome) => outcome.world);
  const characters = outcomes.map((outcome) => outcome.character);

  return {
    world: worlds.includes('kept')
      ? 'kept'
      : worlds.includes('deleted')
        ? 'deleted'
        : 'none',
    character: characters.includes('remembered')
      ? 'remembered'
      : characters.includes('deleted')
        ? 'deleted'
        : 'none',
  };
}
