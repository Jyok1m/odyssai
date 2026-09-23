import { Inject, Injectable } from '@nestjs/common';
import {
  AttributesSchema,
  STORIES_MAX,
  TravellerSchema,
  type Stories,
  type Story,
  type Travellers,
} from '@odyssai/schemas';
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

// Le personnage qu'on voulait reprendre n'existe pas, ou n'est pas a lui.
export class TravellerNotFoundError extends Error {
  constructor() {
    super('personnage absent');
    this.name = 'TravellerNotFoundError';
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
    Les personnages du joueur, et les mondes ou on les retrouve.

    Une essence sans incarnation ne peut pas exister : elle nait de la
    premiere fiche validee. La liste est donc celle de ses personnages, pas
    celle de ses brouillons.
  */
  async travellers(user: Owner): Promise<Travellers> {
    const rows = await this.prisma.essence.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
      include: {
        incarnations: {
          orderBy: { createdAt: 'asc' },
          select: { arrival: true, universe: { select: SUMMARY } },
        },
      },
    });

    return {
      travellers: rows.flatMap((row) => {
        const personality = (row.personality ?? {}) as {
          traits?: string[];
          summary?: string;
        };
        const attributes = AttributesSchema.safeParse(row.attributes);
        // Une essence illisible est sautee plutot que de faire echouer la
        // liste : on ne peut pas la reprendre, les autres si.
        if (!attributes.success) return [];

        const parsed = TravellerSchema.safeParse({
          id: row.id,
          name: row.name,
          gender: row.gender,
          age: row.age,
          traits: personality.traits ?? [],
          summary: personality.summary ?? '',
          attributes: attributes.data,
          incarnations: row.incarnations.flatMap((incarnation) =>
            incarnation.universe
              ? [
                  {
                    universeId: incarnation.universe.id,
                    world: incarnation.universe.name,
                    step: incarnation.universe.step,
                    arrival: incarnation.arrival,
                    accentHue: incarnation.universe.accentHue,
                    current: incarnation.universe.id === user.currentUniverseId,
                  },
                ]
              : [],
          ),
        });
        return parsed.success ? [parsed.data] : [];
      }),
    };
  }

  /*
    Une histoire neuve, ouverte aussitot. Rien n'est genere : elle commence a
    l'inspiration, et c'est le parcours qui la remplit.

    Avec une essence, le personnage arrive deja ecrit : le parcours saute la
    conversation de creation et passe directement a la fiche, que le joueur
    n'a plus qu'a confirmer. Il entre en voyageur, la ou celui qui nait dans
    un monde y est natif.
  */
  async start(user: Owner, essenceId?: string): Promise<Story> {
    const count = await this.prisma.universe.count({ where: { ownerId: user.id } });
    if (count >= STORIES_MAX) throw new StoriesFullError();

    const essence = essenceId ? await this.carry(user.id, essenceId) : null;

    const row = await this.prisma.universe.create({
      data: {
        ownerId: user.id,
        ...(essence
          ? {
              character: {
                create: {
                  essenceId: essence.id,
                  arrival: 'voyageur',
                  name: essence.name,
                  gender: essence.gender,
                  age: essence.age,
                  personality: essence.personality ?? {},
                  attributes: essence.attributes ?? {},
                },
              },
            }
          : {}),
      },
      select: SUMMARY,
    });
    await this.open(user.id, row.id);

    return this.toStory(row, row.id);
  }

  /*
    L'essence a reprendre, rafraichie de ce que sa derniere incarnation est
    devenue.

    Le socle passe d'une incarnation a l'essence a cet instant et a aucun
    autre : le tenir a jour en continu ferait deux verites qui se poursuivent,
    et un personnage qui s'est endurci doit arriver endurci.
  */
  private async carry(userId: string, essenceId: string) {
    const essence = await this.prisma.essence.findUnique({
      where: { id: essenceId, ownerId: userId },
      include: {
        incarnations: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });
    if (!essence) throw new TravellerNotFoundError();

    const latest = essence.incarnations[0];
    const grown = AttributesSchema.safeParse(latest?.attributes);
    if (!grown.success) return essence;

    return this.prisma.essence.update({
      where: { id: essence.id },
      data: { attributes: grown.data },
    });
  }

  async select(user: Owner, universeId: string): Promise<Story> {
    const row = await this.find(user, universeId);
    await this.open(user.id, row.id);
    return this.toStory(row, row.id);
  }

  // Une histoire du joueur, ou rien : celle d'un autre n'existe pas pour lui.
  async find(user: Owner, universeId: string): Promise<Summary> {
    const row = await this.prisma.universe.findUnique({
      where: { id: universeId, ownerId: user.id },
      select: SUMMARY,
    });
    if (!row) throw new StoryNotFoundError();
    return row;
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
