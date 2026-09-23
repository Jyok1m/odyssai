import type { LlmClient } from '@odyssai/llm';
import { drawFlavour, seedEntities } from '@odyssai/engine';
import { Prisma, type PrismaClient } from '@odyssai/db';
import {
  CharacterSheetSchema,
  GENERATION_ATTEMPTS_PER_NODE,
  InspirationSchema,
  WorldBibleSchema,
  entityKey,
  WorldCharterSchema,
  WorldThemesSchema,
  type WorldThemes,
} from '@odyssai/schemas';
import {
  GenerationFailure,
  abstractWorld,
  runGeneration,
  type RunGenerationOptions,
} from '@odyssai/narrator';
import type { WorkerConfig } from './config.js';

/*
  Le plus gros poste de depense du produit : sept appels au mieux,
  vingt-trois au pire, et aucun n'etait compte. L'usage etait pourtant deja
  agrege par le graphe et rendu par abstractWorld.
*/
async function journal(
  deps: GenerateDeps,
  kind: 'abstraction' | 'generation',
  universeId: string,
  ownerId: string | null,
  usages: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
  }[],
): Promise<void> {
  const { inputUsdPerMTok, outputUsdPerMTok } = deps.config.prices;

  for (const usage of usages) {
    if (usage.inputTokens === undefined) continue;

    const cost =
      typeof usage.costUsd === 'number'
        ? usage.costUsd
        : (usage.inputTokens * inputUsdPerMTok +
            (usage.outputTokens ?? 0) * outputUsdPerMTok) /
          1e6;

    await deps.prisma.llmUsage
      .create({
        data: {
          kind,
          provider: deps.config.provider,
          userId: ownerId,
          universeId,
          model:
            usage.model ??
            (kind === 'abstraction'
              ? deps.config.models.abstraction.model
              : deps.config.models.generation.model),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens ?? 0,
          cachedTokens: usage.cachedTokens ?? null,
          costUsd: new Prisma.Decimal(cost.toFixed(8)),
        },
      })
      // Une comptabilite ratee ne vaut pas de perdre un monde qui vient
      // d'etre ecrit.
      .catch(() => undefined);
  }
}

// Le message d'erreur est borne par la colonne : de quoi diagnostiquer.
const ERROR_MAX = 500;

export interface GenerateDeps {
  prisma: PrismaClient;
  llm: LlmClient;
  config: WorkerConfig;
  /*
    Le type vient de narrator et non de @langchain/langgraph : narrator etant
    en CommonJS, ses declarations resolvent le paquet par la condition
    `require`, ce worker par `import`, et les deux identites ne se melangent
    pas. Prendre la sienne met la seule conversion au point d'entree.
  */
  checkpointer?: RunGenerationOptions['checkpointer'];
}

// Le travail est fini, ou n'a jamais eu lieu : rien a generer.
export class NothingToDo extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NothingToDo';
  }
}

function short(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, ERROR_MAX);
}

/*
  Une generation complete, du travail en file au monde ecrit.

  La passe d'abstraction reste hors du graphe. Elle est la seule etape a voir
  les titres cites, et l'avoir a part rend cette frontiere visible ; ses themes
  sont ecrits en base des qu'ils existent, ce qui vaut point de reprise et
  donne en plus une donnee interrogeable, ce qu'un checkpoint n'est pas.
*/
export async function generate(
  deps: GenerateDeps,
  universeId: string,
  signal?: AbortSignal,
): Promise<void> {
  const { prisma } = deps;

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
    include: {
      character: true,
      owner: { select: { id: true, locale: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!universe) throw new NothingToDo('univers absent');
  if (universe.step === 'ready') throw new NothingToDo('monde deja genere');

  // Un monde detache est un monde dont le joueur est parti, conserve parce que
  // d'autres l'avaient visite. Il n'y a plus personne pour qui generer, et pas
  // de langue dans laquelle ecrire.
  if (!universe.owner) throw new NothingToDo('monde sans proprietaire');

  const job = universe.jobs[0];
  if (!job) throw new NothingToDo('aucun travail enregistre');

  const inspiration = InspirationSchema.safeParse(
    universe.mode === 'works'
      ? { mode: 'works', works: universe.works }
      : { mode: 'own', ownDescription: universe.ownDescription ?? '' },
  );
  const character = CharacterSheetSchema.safeParse({
    name: universe.character?.name ?? undefined,
    gender: universe.character?.gender ?? undefined,
    age: universe.character?.age ?? undefined,
    personality: universe.character?.personality ?? undefined,
    attributes: universe.character?.attributes ?? undefined,
  });

  if (!inspiration.success || !character.success) {
    await fail(deps, job.id, universeId, 'saisie incomplete');
    throw new NothingToDo('saisie incomplete');
  }

  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      startedAt: job.startedAt ?? new Date(),
      error: null,
    },
  });

  try {
    // Les themes deja ecrits ne se refont pas : une reprise apres incident ne
    // doit pas repayer l'abstraction.
    let themes = WorldThemesSchema.safeParse(universe.themes).data;

    if (!themes) {
      await step(deps, job.id, 'abstraction');
      themes = await abstract(
        deps,
        universeId,
        universe.owner.id,
        inspiration.data,
        signal,
      );
    }

    const works = inspiration.data.mode === 'works' ? inspiration.data.works : [];

    const outcome = await runGeneration({
      deps: { llm: deps.llm, config: deps.config.models.generation },
      checkpointer: deps.checkpointer,
      input: {
        universeId,
        locale: universe.owner.locale,
        themes,
        character: character.data,
        works,
        // Tire ici, garde dans le fil : une reprise ne retire pas.
        flavour: drawFlavour(),
      },
      signal,
      onStep: (name) => {
        void step(deps, job.id, name === 'characters' ? 'characters' : name);
      },
    });

    await journal(
      deps,
      'generation',
      universeId,
      universe.owner.id,
      outcome.usage,
    );

    // Une seule transaction : un monde a moitie ecrit avec une etape `ready`
    // serait pire qu'un echec, le joueur y entrerait sans lore.
    const bible = WorldBibleSchema.parse(outcome.bible);

    await prisma.$transaction([
      prisma.universe.update({
        where: { id: universeId },
        data: {
          step: 'ready',
          charter: WorldCharterSchema.parse(outcome.charter),
          bible,
          name: bible.lore.name,
          accentHue: bible.lore.accentHue,
        },
      }),
      /*
        Les entites que la bible seme : les personnages avec leur secret, les
        factions. C'est la matiere qui grandira ensuite, et ceux du premier
        jour doivent y etre des le premier tour.
      */
      prisma.entity.createMany({
        data: seedEntities(bible).map((entity) => ({
          universeId,
          kind: entity.kind,
          name: entity.name,
          key: entityKey(entity.name),
          known: entity.known,
          hidden: entity.hidden,
        })),
        skipDuplicates: true,
      }),
      prisma.generationJob.update({
        where: { id: job.id },
        data: { status: 'done', step: 'validation', finishedAt: new Date() },
      }),
    ]);
  } catch (error: unknown) {
    const detail =
      error instanceof GenerationFailure
        ? `${error.step} : ${error.details.slice(0, 3).join(' | ')}`
        : short(error);

    await fail(deps, job.id, universeId, detail);
    throw error;
  }
}

async function abstract(
  deps: GenerateDeps,
  universeId: string,
  ownerId: string,
  inspiration: ReturnType<typeof InspirationSchema.parse>,
  signal?: AbortSignal,
): Promise<WorldThemes> {
  /*
    Elle rejoue, comme un noeud du graphe et pour la meme raison : un JSON
    tronque, une borne depassee ou un nom emprunte sont des sorties du
    modele, pas des pannes, et `abstractWorld` dit lui-meme que l'appelant
    relance. Sans cette boucle, une seule sortie malheureuse emportait une
    generation a vingt-cinq credits, la ou les six autres appels de la chaine
    avaient droit a un second essai.

    Une erreur de transport, elle, remonte tout de suite : c'est BullMQ qui
    la relance, avec son delai.
  */
  const rejections: string[] = [];

  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS_PER_NODE; attempt += 1) {
    const result = await abstractWorld({
      llm: deps.llm,
      config: deps.config.models.abstraction,
      input: { inspiration, locale: 'fr' },
      signal,
      trace: {
        name: 'abstraction',
        metadata: { universe_id: universeId, attempt },
      },
    });

    // Chaque essai se compte : un rejeu est paye comme le reste.
    await journal(deps, 'abstraction', universeId, ownerId, [result.usage]);

    if (result.kind === 'ok') {
      await deps.prisma.universe.update({
        where: { id: universeId },
        data: { themes: result.themes },
      });

      return result.themes;
    }

    rejections.push(`${result.reason} ${result.details.join(' | ')}`.trim());
  }

  throw new Error(`abstraction : ${rejections.join(' ; ')}`);
}

// L'avancement est indicatif : une ecriture ratee ne casse pas le travail.
async function step(
  deps: GenerateDeps,
  jobId: string,
  name: Prisma.GenerationJobUpdateInput['step'],
): Promise<void> {
  await deps.prisma.generationJob
    .update({ where: { id: jobId }, data: { step: name } })
    .catch(() => undefined);
}

/*
  L'univers retombe en `failed`, qui reste ouvert a l'ecriture : c'est la
  seule sortie pour un joueur dont le monde n'a pas abouti.
*/
async function fail(
  deps: GenerateDeps,
  jobId: string,
  universeId: string,
  error: string,
): Promise<void> {
  await deps.prisma
    .$transaction([
      deps.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: error.slice(0, ERROR_MAX), finishedAt: new Date() },
      }),
      deps.prisma.universe.update({
        where: { id: universeId },
        data: { step: 'failed' },
      }),
    ])
    .catch(() => undefined);
}
