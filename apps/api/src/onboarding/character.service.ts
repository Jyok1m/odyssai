import { Inject, Injectable } from '@nestjs/common';
import {
  CHARACTER_TURNS_MAX,
  CHARACTER_TURNS_MIN,
  type CharacterConversation,
  type ConversationMessage,
} from '@odyssai/schemas';
import type { ConversationTurn } from '@odyssai/narrator';
import { PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { LockedError, WrongStepError } from './onboarding.service.js';

/** Les tours sont epuises. La fiche reste extractible de ce qui a ete dit. */
export class ConversationOverError extends Error {
  constructor() {
    super('conversation close');
    this.name = 'ConversationOverError';
  }
}

/** Trop peu d'echanges pour proposer quoi que ce soit. */
export class TooShortError extends Error {
  constructor() {
    super('conversation trop courte');
    this.name = 'TooShortError';
  }
}

const CHANNEL = 'character_creation' as const;

@Injectable()
export class CharacterService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Resout l'univers du joueur et verifie qu'il est bien a cette etape. Toutes
   * les routes de la conversation passent par la : l'etat vit en base, et un
   * ecran ne suffit pas a garantir qu'on y est.
   */
  async open(user: User): Promise<string> {
    const universe = await this.prisma.universe.findUnique({
      where: { ownerId: user.id },
      select: { id: true, step: true },
    });

    if (!universe) throw new WrongStepError();
    if (universe.step === 'generating' || universe.step === 'ready') {
      throw new LockedError();
    }
    if (universe.step !== 'character') throw new WrongStepError();

    return universe.id;
  }

  async conversation(universeId: string): Promise<CharacterConversation> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { universeId, channel: CHANNEL },
      orderBy: { createdAt: 'asc' },
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

  /** Historique dans la forme attendue par le prompt, sans les horodatages. */
  async history(universeId: string): Promise<ConversationTurn[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { universeId, channel: CHANNEL },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    return rows.map((row) => ({ role: row.role, content: row.content }));
  }

  /**
   * Le message du joueur est ecrit avant l'appel au modele, pas apres : une
   * coupure en cours de reponse ne doit pas lui faire perdre ce qu'il a tape.
   */
  async recordUser(universeId: string, content: string): Promise<void> {
    const turns = await this.turnsUsed(universeId);
    if (turns >= CHARACTER_TURNS_MAX) throw new ConversationOverError();

    await this.prisma.conversationMessage.create({
      data: { universeId, channel: CHANNEL, role: 'user', content },
    });
  }

  async recordAssistant(universeId: string, content: string): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: { universeId, channel: CHANNEL, role: 'assistant', content },
    });
  }

  /** Assez d'echanges pour qu'une fiche ait de quoi se remplir. */
  async assertExtractable(universeId: string): Promise<void> {
    if ((await this.turnsUsed(universeId)) < CHARACTER_TURNS_MIN) {
      throw new TooShortError();
    }
  }

  async turnsUsed(universeId: string): Promise<number> {
    return this.prisma.conversationMessage.count({
      where: { universeId, channel: CHANNEL, role: 'user' },
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
