import { Inject, Injectable } from '@nestjs/common';
import { STORIES_MAX, type Stories, type Story } from '@odyssai/schemas';
import { PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';

// Le joueur mene deja autant d'histoires que la borne l'autorise.
export class StoriesFullError extends Error {
  constructor() {
    super('trop d histoires');
    this.name = 'StoriesFullError';
  }
}

// L'histoire n'existe pas, ou n'est pas a ce joueur : meme reponse.
export class StoryNotFoundError extends Error {
  constructor() {
    super('histoire absente');
    this.name = 'StoryNotFoundError';
  }
}

type Owner = Pick<User, 'id' | 'currentUniverseId'>;

/*
  Le filtre de l'histoire ouverte, ou null si le joueur n'en a aucune.

  Le proprietaire est toujours dans le filtre : le pointeur dit laquelle, il
  ne vaut pas preuve. Pure, pour que les services qui lisent l'histoire
  courante n'aient pas a dependre de ce module.
*/
export function currentStory(user: Owner): { id: string; ownerId: string } | null {
  return user.currentUniverseId
    ? { id: user.currentUniverseId, ownerId: user.id }
    : null;
}

const SUMMARY = {
  id: true,
  name: true,
  step: true,
  accentHue: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Summary = {
  id: string;
  name: string | null;
  step: Story['step'];
  accentHue: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/*
  Plusieurs histoires par joueur, sur la meme reserve de credits. Chacune est
  un univers a part entiere ; `users.current_universe_id` dit laquelle est
  ouverte, et tout le parcours comme le tour de jeu lisent celle-la.
*/
@Injectable()
export class StoriesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(user: Owner): Promise<Stories> {
    const rows = await this.prisma.universe.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
      select: SUMMARY,
    });

    return {
      stories: rows.map((row) => this.toStory(row, user.currentUniverseId)),
      max: STORIES_MAX,
    };
  }

  /*
    Une histoire neuve, ouverte aussitot. Rien n'est genere : elle commence a
    l'inspiration, et c'est le parcours qui la remplit.
  */
  async start(user: Owner): Promise<Story> {
    const count = await this.prisma.universe.count({ where: { ownerId: user.id } });
    if (count >= STORIES_MAX) throw new StoriesFullError();

    const row = await this.prisma.universe.create({
      data: { ownerId: user.id },
      select: SUMMARY,
    });
    await this.open(user.id, row.id);

    return this.toStory(row, row.id);
  }

  async select(user: Owner, universeId: string): Promise<Story> {
    const row = await this.prisma.universe.findUnique({
      where: { id: universeId, ownerId: user.id },
      select: SUMMARY,
    });
    if (!row) throw new StoryNotFoundError();

    await this.open(user.id, row.id);
    return this.toStory(row, row.id);
  }

  private async open(userId: string, universeId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { currentUniverseId: universeId },
    });
  }

  private toStory(row: Summary, currentId: string | null): Story {
    return {
      id: row.id,
      name: row.name,
      step: row.step,
      accentHue: row.accentHue,
      current: row.id === currentId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
