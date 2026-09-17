import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CharacterDraftSchema,
  CharacterSheetSchema,
  InspirationSchema,
  type CharacterDraft,
  type GenerationProgress,
  type InspirationDraft,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingUpdate,
} from '@odyssai/schemas';
import { Prisma, PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { GenerationQueueService } from './generation-queue.service.js';

/** L'etape visee n'est pas ouverte : on n'ecrit pas plus loin qu'on n'est. */
export class WrongStepError extends Error {
  constructor() {
    super('etape non ouverte');
    this.name = 'WrongStepError';
  }
}

/** La saisie a ete sauvegardee, mais elle ne suffit pas pour avancer. */
export class IncompleteError extends Error {
  constructor() {
    super('saisie incomplete');
    this.name = 'IncompleteError';
  }
}

/** La generation est lancee ou finie : le parcours n'accepte plus d'ecriture. */
export class LockedError extends Error {
  constructor() {
    super('parcours ferme');
    this.name = 'LockedError';
  }
}

/** Les etapes que le joueur remplit lui-meme, dans l'ordre. */
const EDITABLE = ['inspiration', 'character'] as const;

type EditableStep = (typeof EDITABLE)[number];

/**
 * `failed` reste ouvert : c'est la seule sortie d'une generation qui n'a pas
 * abouti, et la refermer laisserait le joueur sans recours.
 */
function openUpTo(step: OnboardingStep): number {
  if (step === 'failed') return EDITABLE.length - 1;
  return (EDITABLE as readonly string[]).indexOf(step);
}

export function isLocked(step: OnboardingStep): boolean {
  return step === 'generating' || step === 'ready';
}

/** On ecrit a son etape ou en deca, jamais au dela. */
export function canWriteAt(target: EditableStep, current: OnboardingStep): boolean {
  return (EDITABLE as readonly string[]).indexOf(target) <= openUpTo(current);
}

type UniverseRow = Prisma.UniverseGetPayload<{
  include: { character: true };
}> & { jobs?: { status: string; step: string | null; error: string | null }[] };

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly queue: GenerationQueueService,
  ) {}

  /** Lecture seule : une visite ne cree jamais de ligne. */
  async getState(user: User): Promise<OnboardingState> {
    const universe = await this.prisma.universe.findUnique({
      where: { ownerId: user.id },
      include: {
        character: true,
        jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return this.toState(user, universe);
  }

  async save(user: User, update: OnboardingUpdate): Promise<OnboardingState> {
    // L'etape 1 passe par PATCH /me : le pseudo appartient au profil, pas au
    // parcours, et le dupliquer ici en ferait une seconde ecriture a tenir.
    if (!user.username) throw new WrongStepError();

    // La ligne est creee au premier enregistrement, pas a la premiere visite.
    // Un joueur absent n'est jamais verrouille, l'ordre est donc sans risque.
    const existing = await this.prisma.universe.upsert({
      where: { ownerId: user.id },
      create: { ownerId: user.id },
      update: {},
      select: { id: true, step: true },
    });

    if (isLocked(existing.step)) throw new LockedError();
    if (!canWriteAt(update.step, existing.step)) throw new WrongStepError();

    const universe =
      update.step === 'inspiration'
        ? await this.saveInspiration(existing.id, update.inspiration, update.advance)
        : await this.saveCharacter(existing.id, update.character, update.advance);

    return this.toState(user, universe);
  }

  /**
   * Les themes sont une fonction pure de l'inspiration : les laisser en place
   * apres une modification ferait generer un monde a partir d'une saisie que le
   * joueur a depuis changee.
   */
  private async saveInspiration(
    universeId: string,
    inspiration: InspirationDraft,
    advance: boolean,
  ): Promise<UniverseRow> {
    const data: Prisma.UniverseUpdateInput =
      inspiration.mode === 'works'
        ? { mode: 'works', works: inspiration.works, themes: Prisma.DbNull }
        : {
            mode: 'own',
            ownDescription: inspiration.ownDescription,
            themes: Prisma.DbNull,
          };

    const complete = InspirationSchema.safeParse(inspiration).success;
    if (advance && complete) data.step = 'character';

    const universe = await this.prisma.universe.update({
      where: { id: universeId },
      data,
      include: {
        character: true,
        jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // Refus apres l'ecriture, et non a la place : rien de ce que le joueur a
    // tape ne doit se perdre parce qu'il a clique trop tot.
    if (advance && !complete) throw new IncompleteError();
    return universe;
  }

  private async saveCharacter(
    universeId: string,
    character: CharacterDraft,
    advance: boolean,
  ): Promise<UniverseRow> {
    const data = {
      name: character.name ?? null,
      gender: character.gender ?? null,
      age: character.age ?? null,
      personality: character.personality ?? Prisma.DbNull,
      attributes: character.attributes ?? Prisma.DbNull,
    };

    await this.prisma.character.upsert({
      where: { universeId },
      create: { universeId, ...data },
      update: data,
    });

    const complete = CharacterSheetSchema.safeParse(character).success;
    if (advance && complete) {
      await this.prisma.universe.update({
        where: { id: universeId },
        data: { step: 'generating' },
      });
      // La ligne d'abord, la file ensuite : c'est elle qui rend la generation
      // interrogeable et diagnosticable, Redis ne fait que transporter.
      await this.prisma.generationJob.create({ data: { universeId } });
      await this.queue.enqueue(universeId);
    }

    const universe = await this.prisma.universe.findUniqueOrThrow({
      where: { id: universeId },
      include: {
        character: true,
        jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (advance && !complete) throw new IncompleteError();
    return universe;
  }

  private toState(user: User, universe: UniverseRow | null): OnboardingState {
    return {
      universeId: universe?.id ?? null,
      // Le pseudo commande tout : tant qu'il manque, rien d'autre ne s'ouvre.
      step: !user.username ? 'username' : (universe?.step ?? 'inspiration'),
      username: user.username,
      inspiration: this.toInspiration(universe),
      character: this.toCharacter(universe?.character ?? null),
      generation: this.toGeneration(universe),
    };
  }

  private toInspiration(universe: UniverseRow | null): InspirationDraft | null {
    if (!universe?.mode) return null;

    return universe.mode === 'works'
      ? { mode: 'works', works: universe.works }
      : { mode: 'own', ownDescription: universe.ownDescription ?? '' };
  }

  /**
   * Le JSON relu est valide comme il a ete ecrit : une colonne Json n'a pas de
   * forme, et rien ne garantit qu'une version anterieure y ait mis la meme.
   */
  private toCharacter(
    row: { name: string | null; gender: string | null; age: number | null; personality: unknown; attributes: unknown } | null,
  ): CharacterDraft | null {
    if (!row) return null;

    const parsed = CharacterDraftSchema.safeParse({
      name: row.name ?? undefined,
      gender: row.gender ?? undefined,
      age: row.age ?? undefined,
      personality: row.personality ?? undefined,
      attributes: row.attributes ?? undefined,
    });

    if (parsed.success) return parsed.data;

    this.logger.warn('fiche de personnage illisible, ignoree');
    return null;
  }

  private toGeneration(universe: UniverseRow | null): GenerationProgress | null {
    const job = universe?.jobs?.[0];
    if (!job) return null;

    return {
      status: job.status as GenerationProgress['status'],
      step: job.step as GenerationProgress['step'],
      error: job.error,
    };
  }
}
