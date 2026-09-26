import { Inject, Injectable, Logger } from '@nestjs/common';
import { partyShare } from '@odyssai/engine';
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
  type Party,
} from '@odyssai/schemas';
import { Prisma, PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { CreditsService } from '../credits/credits.service.js';
import { PartyService } from '../party/party.service.js';
import { GenerationQueueService } from './generation-queue.service.js';
import { GenerationRefundService } from './generation-refund.service.js';
import { StoriesService, openStoryWhere } from '../stories/stories.service.js';

// L'etape visee n'est pas ouverte : on n'ecrit pas plus loin qu'on n'est.
export class WrongStepError extends Error {
  constructor() {
    super('etape non ouverte');
    this.name = 'WrongStepError';
  }
}

// La saisie a ete sauvegardee, mais elle ne suffit pas pour avancer.
export class IncompleteError extends Error {
  constructor() {
    super('saisie incomplete');
    this.name = 'IncompleteError';
  }
}

// La generation est lancee ou finie : le parcours n'accepte plus d'ecriture.
export class LockedError extends Error {
  constructor() {
    super('parcours ferme');
    this.name = 'LockedError';
  }
}

// Les etapes que le joueur remplit lui-meme, dans l'ordre.
const EDITABLE = ['inspiration', 'character'] as const;

type EditableStep = (typeof EDITABLE)[number];

/*
  `failed` reste ouvert : c'est la seule sortie d'une generation qui n'a pas
  abouti, et la refermer laisserait le joueur sans recours.
*/
function openUpTo(step: OnboardingStep): number {
  if (step === 'failed') return EDITABLE.length - 1;
  return (EDITABLE as readonly string[]).indexOf(step);
}

export function isLocked(step: OnboardingStep): boolean {
  return step === 'generating' || step === 'ready';
}

// On ecrit a son etape ou en deca, jamais au dela.
export function canWriteAt(target: EditableStep, current: OnboardingStep): boolean {
  return (EDITABLE as readonly string[]).indexOf(target) <= openUpTo(current);
}

/*
  Ce que la lecture d'une histoire embarque : sa table quand elle en a une,
  et les fiches qu'on y incarne. Le personnage du joueur est le sien, et lui
  seul : une histoire solo en porte un, une partie un par membre.
*/
const READ = (userId: string) =>
  ({
    characters: { where: { ownerId: userId } },
    party: {
      include: {
        members: {
          orderBy: { joinedAt: 'asc' as const },
          include: { user: { select: { username: true } } },
        },
      },
    },
    jobs: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  }) as const satisfies Prisma.UniverseInclude;

type UniverseRow = Prisma.UniverseGetPayload<{
  include: ReturnType<typeof READ>;
}>;

// Le siege du joueur, avec la taille de sa table.
interface Seat {
  userId: string;
  partyId: string;
  partySize: number;
  ready: boolean;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly queue: GenerationQueueService,
    private readonly credits: CreditsService,
    private readonly refunds: GenerationRefundService,
    private readonly stories: StoriesService,
    private readonly parties: PartyService,
  ) {}

  // Lecture seule : une visite ne cree jamais de ligne.
  async getState(user: User): Promise<OnboardingState> {
    const where = openStoryWhere(user);
    const universe = where
      ? await this.prisma.universe.findFirst({ where, include: READ(user.id) })
      : null;

    /*
      Une generation qui a echoue se solde ici aussi : celui qui revient plus
      tard n'ouvre pas le flux d'avancement, et ses credits l'attendraient
      indefiniment.
    */
    if (universe?.step === 'failed') await this.refunds.settle(universe.id);

    return this.toState(user, universe);
  }

  async save(user: User, update: OnboardingUpdate): Promise<OnboardingState> {
    // L'etape 1 passe par PATCH /me : le pseudo appartient au profil, pas au
    // parcours, et le dupliquer ici en ferait une seconde ecriture a tenir.
    if (!user.username) throw new WrongStepError();

    // La ligne est creee au premier enregistrement, pas a la premiere visite :
    // sans histoire ouverte, cette ecriture en commence une.
    const where = openStoryWhere(user);
    const opened = where
      ? await this.prisma.universe.findFirst({
          where,
          select: { id: true, step: true },
        })
      : null;
    const existing = opened ?? (await this.stories.start(user));

    if (isLocked(existing.step)) throw new LockedError();
    if (!canWriteAt(update.step, existing.step)) throw new WrongStepError();

    /*
      Une table se remplit a plusieurs : l'inspiration s'ecrit sur le siege,
      la fiche est celle du joueur dans cet univers, et l'avancee n'entraine
      l'histoire que quand tout le monde y est.
    */
    const universe = update.step === 'inspiration'
      ? await this.saveInspiration(user.id, existing.id, update.inspiration, update.advance)
      : await this.saveCharacter(
          user.id,
          existing.id,
          update.character,
          update.advance,
        );

    return this.toState(user, universe);
  }

  /*
    Les themes sont une fonction pure de l'inspiration : les laisser en place
    apres une modification ferait generer un monde a partir d'une saisie que le
    joueur a depuis changee.

    Dans une partie, l'inspiration est celle du siege : les oeuvres citees
    de chacun, et l'abstraction recevra l'union.
  */
  private async saveInspiration(
    userId: string,
    universeId: string,
    inspiration: InspirationDraft,
    advance: boolean,
  ): Promise<UniverseRow> {
    const seat = await this.seatOf(userId, universeId);

    // Une table se nourrit d'oeuvres citees : fusionner des descriptions
    // libres n'a pas de regle, et l'union des titres en a une.
    if (seat && inspiration.mode !== 'works') throw new WrongStepError();

    if (seat) {
      await this.prisma.$transaction([
        this.prisma.partyMember.update({
          where: { userId },
          data: { works: inspiration.mode === 'works' ? inspiration.works : [] },
        }),
        // Les themes derivent de l'union des oeuvres : une saisie bougee les
        // rend faux, comme en solo.
        this.prisma.universe.update({
          where: { id: universeId },
          data: { themes: Prisma.DbNull },
        }),
      ]);
    } else {
      await this.prisma.universe.update({
        where: { id: universeId },
        data:
          inspiration.mode === 'works'
            ? { mode: 'works', works: inspiration.works, themes: Prisma.DbNull }
            : {
                mode: 'own',
                ownDescription: inspiration.ownDescription,
                themes: Prisma.DbNull,
              },
      });
    }

    const complete = InspirationSchema.safeParse(inspiration).success;

    /*
      L'etape de l'histoire avance quand TOUTES les oeuvres de la table y
      sont : c'est l'etape du groupe, et ecrire a son etape ou en deca vaut
      pour chacun. Avant cela, la sauvegarde est reelle et l'attente visible.
    */
    if (seat && complete && advance) {
      await this.advanceWorks(seat.partyId, universeId);
    }

    if (!seat && complete && advance) {
      await this.prisma.universe.update({
        where: { id: universeId },
        data: { step: 'character' },
      });
    }

    const universe = await this.read(userId, universeId);

    // Refus apres l'ecriture, et non a la place : rien de ce que le joueur a
    // tape ne doit se perdre parce qu'il a clique trop tot.
    if (advance && !complete) throw new IncompleteError();
    return universe;
  }

  /*
    L'histoire quitte l'inspiration quand tous les sieges ont cite leurs
    oeuvres : la porte se ferme, on ne la rejoint plus.
  */
  private async advanceWorks(partyId: string, universeId: string): Promise<void> {
    const party = await this.prisma.party.findUniqueOrThrow({
      where: { id: partyId },
      include: { members: { orderBy: { joinedAt: 'asc' } } },
    });

    const all = party.members.every((member) =>
      InspirationSchema.safeParse({ mode: 'works', works: member.works }).success,
    );
    if (!all) return;

    await this.prisma.universe.update({
      where: { id: universeId },
      data: { step: 'character' },
    });
  }

  private async saveCharacter(
    userId: string,
    universeId: string,
    character: CharacterDraft,
    advance: boolean,
  ): Promise<UniverseRow> {
    const seat = await this.seatOf(userId, universeId);

    /*
      Sa fiche est validee et sa part payee : elle ne se reecrit plus tant
      que la table n'a pas avance. Le laisser faire serait le faire payer
      deux fois sa part sans le lui dire. Apres un echec de generation,
      l'etape `failed` reouvre tout le monde : la part rendue se repaiera au
      prochain passage, comme un solo qui relance.
    */
    if (seat?.ready) {
      const universe = await this.prisma.universe.findUniqueOrThrow({
        where: { id: universeId },
        select: { step: true },
      });
      if (universe.step !== 'failed') throw new LockedError();

      await this.prisma.partyMember.update({
        where: { userId },
        data: { ready: false },
      });
    }

    const data = {
      name: character.name ?? null,
      gender: character.gender ?? null,
      age: character.age ?? null,
      personality: character.personality ?? Prisma.DbNull,
      attributes: character.attributes ?? Prisma.DbNull,
    };

    // Le sien dans cet univers : une fiche par joueur et par histoire.
    await this.prisma.character.upsert({
      where: { universeId_ownerId: { universeId, ownerId: userId } },
      create: { universeId, ownerId: userId, ...data },
      update: data,
    });

    const sheet = CharacterSheetSchema.safeParse(character);
    const complete = sheet.success;

    /*
      La fiche validee fait naitre l'essence : c'est ce que ce personnage
      emportera s'il franchit une faille un jour. Une seule fois, et jamais
      pour un voyageur, qui arrive avec la sienne.

      Ici et non a la generation : une essence est ce que le joueur a ecrit,
      pas ce que le monde en a fait.
    */
    if (complete) {
      const existing = await this.prisma.character.findUnique({
        where: { universeId_ownerId: { universeId, ownerId: userId } },
        select: { id: true, essenceId: true },
      });

      if (existing && !existing.essenceId) {
        const born = await this.prisma.essence.create({
          data: {
            ownerId: userId,
            name: sheet.data.name,
            gender: sheet.data.gender,
            age: sheet.data.age,
            personality: sheet.data.personality,
            attributes: sheet.data.attributes,
          },
          select: { id: true },
        });
        await this.prisma.character.update({
          where: { id: existing.id },
          data: { essenceId: born.id },
        });
      }
    }

    if (advance && complete) {
      if (seat) {
        /*
          Sa part du monde, a lui : debitee au moment ou SA fiche est validee,
          comme le solo paie la sienne au moment ou il valide. Le dernier pret
          lance la generation, et seulement si la table est pleine : un siege
          vide, c'est quelqu'un qu'on attend encore.
        */
        await this.credits.spend(
          'worldGeneration',
          userId,
          universeId,
          partyShare(seat.partySize),
        );

        await this.prisma.partyMember.update({
          where: { userId },
          data: { ready: true },
        });
        await this.launch(seat.partyId, universeId);
      } else {
        /*
          Debite ici et non dans le worker : un refus doit arriver avant que le
          travail ne parte en file, sans quoi le joueur verrait une generation
          demarrer puis echouer.
        */
        await this.credits.spend('worldGeneration', userId, universeId);

        await this.prisma.universe.update({
          where: { id: universeId },
          data: { step: 'generating' },
        });
        // La ligne d'abord, la file ensuite : c'est elle qui rend la generation
        // interrogeable et diagnosticable, Redis ne fait que transporter.
        await this.prisma.generationJob.create({ data: { universeId } });
        await this.queue.enqueue(universeId);
      }
    }

    const universe = await this.read(userId, universeId);

    if (advance && !complete) throw new IncompleteError();
    return universe;
  }

  /*
    La generation part quand tous les sieges sont prets et que la table est
    pleine. Celui qui complete dernier declenche l'unique generation.

    L'ecriture conditionnelle designe le gagnant : deux avancees simultanees
    voient toutes deux la table prete, et seule celle qui fait passer l'etape
    enregistre le travail et part en file. Le meme verrou rembourse les
    generations ratees, et il tient le meme role ici.
  */
  private async launch(partyId: string, universeId: string): Promise<void> {
    const party = await this.prisma.party.findUniqueOrThrow({
      where: { id: partyId },
      include: { members: { orderBy: { joinedAt: 'asc' } } },
    });

    const full = party.members.length === party.size;
    const all = party.members.every((member) => member.ready);
    if (!full || !all) return;

    const moved = await this.prisma.universe.updateMany({
      where: { id: universeId, step: { in: ['character', 'failed'] } },
      data: { step: 'generating' },
    });
    if (moved.count === 0) return;

    await this.prisma.generationJob.create({ data: { universeId } });
    await this.queue.enqueue(universeId);
  }

  // Le siege du joueur dans cette histoire, ou rien pour un solo.
  private async seatOf(userId: string, universeId: string): Promise<Seat | null> {
    const seat = await this.prisma.partyMember.findUnique({
      where: { userId },
      select: {
        userId: true,
        partyId: true,
        ready: true,
        party: { select: { size: true, universeId: true } },
      },
    });

    if (!seat || seat.party.universeId !== universeId) return null;

    return {
      userId: seat.userId,
      partyId: seat.partyId,
      partySize: seat.party.size,
      ready: seat.ready,
    };
  }

  private async read(userId: string, universeId: string): Promise<UniverseRow> {
    return this.prisma.universe.findFirstOrThrow({
      where: { id: universeId },
      include: READ(userId),
    });
  }

  private async toState(user: User, universe: UniverseRow | null): Promise<OnboardingState> {
    return {
      universeId: universe?.id ?? null,
      // Le pseudo commande tout : tant qu'il manque, rien d'autre ne s'ouvre.
      step: !user.username ? 'username' : (universe?.step ?? 'inspiration'),
      username: user.username,
      inspiration: this.toInspiration(user.id, universe),
      character: this.toCharacter(user.id, universe),
      // Nulle tant qu'il n'y a pas de fiche : l'ecran s'en sert pour savoir
      // s'il ouvre une conversation de creation ou montre un personnage qu'on
      // amene.
      arrival: universe?.characters[0]?.arrival ?? null,
      generation: this.toGeneration(universe),
      party: universe?.party ? await this.toPartyBlock(user.id, universe) : null,
    };
  }

  /*
    Dans une table, l'inspiration vit sur le siege. La relecture la rend dans
    la forme que l'ecran attend, et les deux modes du solo restent les siens.
  */
  private toInspiration(
    userId: string,
    universe: UniverseRow | null,
  ): InspirationDraft | null {
    if (!universe) return null;

    const seat = universe.party?.members.find((member) => member.userId === userId);
    if (seat) return { mode: 'works', works: seat.works };

    if (!universe.mode) return null;

    return universe.mode === 'works'
      ? { mode: 'works', works: universe.works }
      : { mode: 'own', ownDescription: universe.ownDescription ?? '' };
  }

  /*
    Le JSON relu est valide comme il a ete ecrit : une colonne Json n'a pas de
    forme, et rien ne garantit qu'une version anterieure y ait mis la meme.
  */
  private toCharacter(
    userId: string,
    universe: UniverseRow | null,
  ): CharacterDraft | null {
    // Le sien, et lui seul : une partie en porte une par membre.
    const row = universe?.characters[0] ?? null;
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

  /*
    La table telle que l'ecran l'attend : les sieges, les noms de personnages,
    qui est pret. La forme est celle de PartyService, une seule definition du
    contrat.
  */
  private async toPartyBlock(userId: string, universe: UniverseRow): Promise<Party> {
    return this.parties.withCharacterNames(
      this.parties.toParty(universe.party!, userId),
    );
  }
}
