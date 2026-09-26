import { Inject, Injectable } from '@nestjs/common';
import {
  CHARACTER_TURNS_MAX,
  CHARACTER_TURNS_MIN,
  type CharacterConversation,
  type ConversationMessage,
} from '@odyssai/schemas';
import type { ConversationTurn } from '@odyssai/narrator';
import { Prisma, PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { isUniqueViolation } from '../prisma/unique-violation.js';
import { LockedError, WrongStepError } from './onboarding.service.js';
import { openStoryWhere } from '../stories/stories.service.js';

// Les tours sont epuises. La fiche reste extractible de ce qui a ete dit.
export class ConversationOverError extends Error {
  constructor() {
    super('conversation close');
    this.name = 'ConversationOverError';
  }
}

// Trop peu d'echanges pour proposer quoi que ce soit.
export class TooShortError extends Error {
  constructor() {
    super('conversation trop courte');
    this.name = 'TooShortError';
  }
}

const CHANNEL = 'character_creation' as const;

/*
  Le fil d'un joueur dans cette conversation. Nul dans une histoire solo, ou
  tout le journal est a un seul ; l'identifiant du membre dans une table, ou
  chacun cause avec le meneur de son cote. Les reponses du meneur portent le
  meme fil que la question : c'est un dialogue, pas un canal public.
*/
export type ThreadKey = string | null;

@Injectable()
export class CharacterService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /*
    Resout l'univers du joueur et verifie qu'il est bien a cette etape. Toutes
    les routes de la conversation passent par la : l'etat vit en base, et un
    ecran ne suffit pas a garantir qu'on y est.
  */
  async open(user: User): Promise<{ universeId: string; thread: ThreadKey }> {
    const where = openStoryWhere(user);
    const universe = where
      ? await this.prisma.universe.findFirst({
          where,
          select: { id: true, step: true },
        })
      : null;

    if (!universe) throw new WrongStepError();
    if (universe.step === 'generating' || universe.step === 'ready') {
      throw new LockedError();
    }
    if (universe.step !== 'character') throw new WrongStepError();

    // Le fil : le sien dans une table, le journal entier dans un solo.
    const seat = await this.prisma.partyMember.findUnique({
      where: { userId: user.id },
      select: { party: { select: { universeId: true } } },
    });

    return {
      universeId: universe.id,
      thread: seat?.party.universeId === universe.id ? user.id : null,
    };
  }

  /*
    Remettre la creation a zero : la conversation et le brouillon de fiche
    partent, l'inspiration et ses themes restent. Le monde n'existe pas
    encore, donc rien d'autre ne tient au personnage.

    Dans une table, seul le fil du joueur part : celui des autres est a eux,
    et la reponse du meneur qui leur est adresse aussi.

    Les credits depenses pour ces messages ne sont pas rendus : les appels ont
    eu lieu, et le joueur les a lus.

    Un siege pret a paye sa part sur cette fiche : la remettre a zero
    laissait le siege pret sans fiche, que la generation ecartait sans rien
    dire, et le joueur ne trouvait plus jamais de partie. Il est ferme, comme
    la fiche elle-meme l'est au parcours.
  */
  async reset(universeId: string, thread: ThreadKey): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (thread) {
        /*
          Une ecriture qui ne change rien, pour prendre la ligne du siege :
          une avancee simultanee attend la fin de celle-ci, et un siege deja
          pret ne correspond pas.
        */
        const open = await tx.partyMember.updateMany({
          where: { userId: thread, ready: false },
          data: { ready: false },
        });
        if (open.count === 0) throw new LockedError();
      }

      await tx.conversationMessage.deleteMany({
        where: threaded(thread, {
          universeId,
          channel: CHANNEL,
        }),
      });
      // La fiche, la sienne : une par joueur et par univers.
      await tx.character.deleteMany({
        where: { universeId, ...(thread ? { ownerId: thread } : {}) },
      });
    });
  }

  async conversation(
    universeId: string,
    thread: ThreadKey,
  ): Promise<CharacterConversation> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: threaded(thread, { universeId, channel: CHANNEL }),
      orderBy: { seq: 'asc' },
    });

    return this.toConversation(
      rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  }

  // Historique dans la forme attendue par le prompt, sans les horodatages.
  async history(universeId: string, thread: ThreadKey): Promise<ConversationTurn[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: threaded(thread, { universeId, channel: CHANNEL }),
      orderBy: { seq: 'asc' },
      select: { role: true, content: true },
    });

    return rows.map((row) => ({ role: row.role, content: row.content }));
  }

  /*
    Le message du joueur est ecrit avant l'appel au modele, pas apres : une
    coupure en cours de reponse ne doit pas lui faire perdre ce qu'il a tape.
  */
  async recordUser(
    universeId: string,
    thread: ThreadKey,
    content: string,
  ): Promise<void> {
    const turns = await this.turnsUsed(universeId, thread);
    if (turns >= CHARACTER_TURNS_MAX) throw new ConversationOverError();

    await this.record(universeId, thread, 'user', content);
  }

  async recordAssistant(
    universeId: string,
    thread: ThreadKey,
    content: string,
  ): Promise<void> {
    await this.record(universeId, thread, 'assistant', content);
  }

  /*
    Ecrit un message avec son rang.

    Le rang est unique par (univers, canal), pas par fil : un seul compteur
    par canal, les fils le lisent filtre. Deux membres ecrivant en meme temps
    peuvent donc viser le meme rang, et la contrainte tranche : on relit et
    on repose une fois, la course est rare et bornee.
  */
  private async record(
    universeId: string,
    thread: ThreadKey,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.conversationMessage.create({
          data: {
            universeId,
            channel: CHANNEL,
            role,
            content,
            memberId: thread,
            seq: await this.nextSeq(universeId),
          },
        });
        return;
      } catch (error: unknown) {
        if (!isUniqueViolation(error) || attempt === 1) throw error;
      }
    }
  }

  /*
    Le rang suivant dans le canal, comme le fait le tour de jeu. La colonne a
    un defaut a zero, qui ne vaut que pour la premiere ligne : sans rang
    explicite, le deuxieme message tombait sur la contrainte d'unicite
    (univers, canal, rang) et la conversation s'arretait au premier echange.
  */
  private async nextSeq(universeId: string): Promise<number> {
    const last = await this.prisma.conversationMessage.findFirst({
      where: { universeId, channel: CHANNEL },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    return last ? last.seq + 1 : 0;
  }

  // Assez d'echanges pour qu'une fiche ait de quoi se remplir.
  async assertExtractable(universeId: string, thread: ThreadKey): Promise<void> {
    if ((await this.turnsUsed(universeId, thread)) < CHARACTER_TURNS_MIN) {
      throw new TooShortError();
    }
  }

  async turnsUsed(universeId: string, thread: ThreadKey): Promise<number> {
    return this.prisma.conversationMessage.count({
      where: threaded(thread, { universeId, channel: CHANNEL, role: 'user' }),
    });
  }

  toConversation(messages: ConversationMessage[]): CharacterConversation {
    const turns = messages.filter((message) => message.role === 'user').length;

    return {
      messages,
      turnsLeft: Math.max(0, CHARACTER_TURNS_MAX - turns),
      canExtract: turns >= CHARACTER_TURNS_MIN,
    };
  }
}

/*
  Le fil dans un where : nul dans un solo, donc tout le journal y passe ; son
  identifiant dans une table, donc seul son fil.
*/
function threaded(thread: ThreadKey, where: Prisma.ConversationMessageWhereInput) {
  return thread ? { ...where, memberId: thread } : where;
}
