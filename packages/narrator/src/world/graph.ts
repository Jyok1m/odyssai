import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { LlmClient } from '@odyssai/llm';
import {
  AffinitySchema,
  FactionSchema,
  GENERATION_ATTEMPTS_PER_NODE,
  GENERATION_REWRITES_MAX,
  NpcSchema,
  PoliticsSchema,
  WorldBibleSchema,
  WorldArcSchema,
  WorldCharterSchema,
  WorldLoreSchema,
  bibleProse,
  findBorrowedNames,
  overusedNamesIn,
  type Flavour,
  type Affinity,
  type CharacterSheet,
  type Faction,
  type Npc,
  type Politics,
  type UiLocale,
  type WorldBible,
  type WorldArc,
  type WorldCharter,
  type WorldLore,
  type WorldThemes,
} from '@odyssai/schemas';
import { z } from 'zod';
import {
  GENERATION_PROMPT,
  type GenerationNode,
} from '../prompts/generation/v1.js';
import { callJson, type JsonModelConfig, type JsonUsage } from './json.js';

export const GENERATION_PROMPT_VERSION = GENERATION_PROMPT.id;

/*
  Les deux reglages du graphe viennent de `@odyssai/schemas`, ou
  `@odyssai/engine` les reexporte dans son index de reglages : un bouton qui
  ne se voit que dans le fichier qui s'en sert ne se tourne jamais.
*/
const ATTEMPTS_PER_NODE = GENERATION_ATTEMPTS_PER_NODE;
const REWRITES_MAX = GENERATION_REWRITES_MAX;

export class GenerationFailure extends Error {
  readonly step: GenerationNode | 'validation';
  readonly details: string[];

  constructor(step: GenerationFailure['step'], details: string[]) {
    super(`${step} : ${details.join(' | ') || 'echec'}`);
    this.name = 'GenerationFailure';
    this.step = step;
    this.details = details;
  }
}

/*
  Etat du graphe.

  `works` y figure pour le seul noeud de controle. Aucun noeud creatif ne peut
  le transmettre a un modele sans y mettre du sien : `GenerationContext`, le
  type que prend le constructeur de prompts, n'a pas de champ pour le porter.
  C'est la forme du type qui tient l'invariant, pas une consigne.
*/
const GenerationState = Annotation.Root({
  universeId: Annotation<string>,
  locale: Annotation<UiLocale>,
  themes: Annotation<WorldThemes>,
  characters: Annotation<CharacterSheet[]>,
  works: Annotation<string[]>,
  // Le registre et la palette tires par le worker, gardes avec le fil.
  flavour: Annotation<Flavour>,

  charter: Annotation<WorldCharter | undefined>,
  lore: Annotation<WorldLore | undefined>,
  factions: Annotation<Faction[] | undefined>,
  politics: Annotation<Politics | undefined>,
  npcs: Annotation<Npc[] | undefined>,
  affinities: Annotation<Affinity[] | undefined>,
  arc: Annotation<WorldArc | undefined>,

  // Noms empruntes releves par le controle, s'il y en a.
  borrowed: Annotation<string[] | undefined>,
  rewrites: Annotation<number>,
  usage: Annotation<JsonUsage[]>({
    reducer: (current, next) => [...(current ?? []), ...next],
    default: () => [],
  }),
});

export type GenerationStateType = typeof GenerationState.State;

export interface GraphDeps {
  llm: LlmClient;
  config: JsonModelConfig;
}

// Ce que les noeuds suivants relisent, sans jamais voir les titres.
function produced(state: GenerationStateType): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (state.charter) value.charter = state.charter;
  if (state.lore) value.lore = state.lore;
  if (state.factions) value.factions = state.factions;
  if (state.politics) value.politics = state.politics;
  if (state.npcs) value.npcs = state.npcs;
  return value;
}

/*
  Un noeud creatif. Le schema tranche : ce que le modele rend et qui ne tient
  pas est rejoue, et au bout de deux essais le travail echoue plutot que
  d'ecrire un monde a moitie forme.
*/
function node<T, K extends keyof GenerationStateType>(
  deps: GraphDeps,
  step: GenerationNode,
  field: K,
  schema: z.ZodType<T>,
  pick: (value: unknown) => unknown,
  // Ce que le schema ne dit pas et qui vaut pourtant un rejeu : les noms.
  check: (value: T) => string[] = () => [],
) {
  return async function run(
    state: GenerationStateType,
  ): Promise<Partial<GenerationStateType>> {
    const usage: JsonUsage[] = [];
    let details: string[] = ['sortie illisible'];

    for (let attempt = 1; attempt <= ATTEMPTS_PER_NODE; attempt += 1) {
      const result = await callJson({
        llm: deps.llm,
        config: deps.config,
        messages: GENERATION_PROMPT.build(step, state.locale, {
          themes: state.themes,
          characters: state.characters,
          produced: produced(state),
          flavour: state.flavour,
        }),
        trace: {
          name: `generation-${step}`,
          metadata: {
            universe_id: state.universeId,
            prompt_version: GENERATION_PROMPT.id,
            step,
            attempt,
          },
        },
      });

      usage.push(result.usage);
      if (result.kind === 'invalid_json') continue;

      const parsed = schema.safeParse(pick(result.value));
      if (parsed.success) {
        const faults = check(parsed.data);
        if (faults.length === 0) {
          return {
            [field]: parsed.data,
            usage,
          } as Partial<GenerationStateType>;
        }
        details = faults;
        continue;
      }

      details = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
      );
    }

    throw new GenerationFailure(step, details);
  };
}

// Le modele repond parfois l'objet nu, parfois enveloppe sous sa cle.
function under(key: string) {
  return (value: unknown): unknown => {
    if (value !== null && typeof value === 'object' && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return value;
  };
}

/*
  Dernier etage de la garde sur la propriete intellectuelle. Il relit tout ce
  qui a ete produit contre les titres saisis : un nom peut avoir traverse
  l'abstraction sans encombre et reapparaitre ici, le modele l'ayant retrouve
  seul a partir des themes.
*/
function validate(state: GenerationStateType): Partial<GenerationStateType> {
  if (!state.charter) {
    throw new GenerationFailure('validation', ['charte absente']);
  }

  const bible = WorldBibleSchema.safeParse({
    lore: state.lore,
    factions: state.factions,
    politics: state.politics,
    npcs: state.npcs,
    affinities: state.affinities,
    arc: state.arc,
  });

  if (!bible.success) {
    throw new GenerationFailure(
      'validation',
      bible.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
      ),
    );
  }

  const borrowed = findBorrowedNames(
    bibleProse(state.charter, bible.data),
    state.works,
  );

  return { borrowed, rewrites: state.rewrites + (borrowed.length > 0 ? 1 : 0) };
}

/*
  Les noeuds sont prefixes : LangGraph refuse qu'un noeud porte le nom d'un
  canal d'etat, et `charter`, `lore` ou `factions` sont les deux a la fois.
*/
const WRITE = {
  charter: 'write_charter',
  lore: 'write_lore',
  factions: 'write_factions',
  politics: 'write_politics',
  characters: 'write_characters',
  affinities: 'write_affinities',
  arc: 'write_arc',
} as const satisfies Record<GenerationNode, string>;

function afterValidation(
  state: GenerationStateType,
): typeof WRITE.lore | typeof END {
  if ((state.borrowed?.length ?? 0) === 0) return END;
  // Le lore porte les noms : c'est de lui que tout le reste decoule.
  if (state.rewrites <= REWRITES_MAX) return WRITE.lore;
  throw new GenerationFailure('validation', state.borrowed ?? []);
}

export function buildGenerationGraph(deps: GraphDeps) {
  return new StateGraph(GenerationState)
    .addNode(
      WRITE.charter,
      node(deps, 'charter', 'charter', WorldCharterSchema, under('charter')),
    )
    .addNode(
      WRITE.lore,
      node(deps, 'lore', 'lore', WorldLoreSchema, under('lore')),
    )
    .addNode(
      WRITE.factions,
      node(
        deps,
        'factions',
        'factions',
        z.array(FactionSchema).min(2).max(5),
        under('factions'),
        (rows) => overusedNamesIn(rows.map((row) => row.name)).map((name) => `nom trop vu : ${name}`),
      ),
    )
    .addNode(
      WRITE.politics,
      node(deps, 'politics', 'politics', PoliticsSchema, under('politics')),
    )
    // L'etape s'appelle characters, mais elle ecrit npcs : le personnage du
    // joueur, lui, existe deja.
    .addNode(
      WRITE.characters,
      node(
        deps,
        'characters',
        'npcs',
        z.array(NpcSchema).min(3).max(6),
        under('npcs'),
        (rows) => overusedNamesIn(rows.map((row) => row.name)).map((name) => `nom trop vu : ${name}`),
      ),
    )
    .addNode(
      WRITE.affinities,
      node(
        deps,
        'affinities',
        'affinities',
        z.array(AffinitySchema).min(3).max(10),
        under('affinities'),
      ),
    )
    /*
      L'arc vient apres tout le reste : il se sert des factions et des
      personnages, et une histoire ecrite avant eux n'aurait rien a quoi se
      raccrocher.
    */
    .addNode(WRITE.arc, node(deps, 'arc', 'arc', WorldArcSchema, under('arc')))
    .addNode('validation', validate)
    .addEdge(START, WRITE.charter)
    .addEdge(WRITE.charter, WRITE.lore)
    .addEdge(WRITE.lore, WRITE.factions)
    .addEdge(WRITE.factions, WRITE.politics)
    .addEdge(WRITE.politics, WRITE.characters)
    .addEdge(WRITE.characters, WRITE.affinities)
    .addEdge(WRITE.affinities, WRITE.arc)
    .addEdge(WRITE.arc, 'validation')
    .addConditionalEdges('validation', afterValidation, [WRITE.lore, END]);
}

// Nom de noeud vers etape, pour l'avancement rendu au joueur.
const STEP_OF = Object.fromEntries(
  Object.entries(WRITE).map(([step, id]) => [id, step]),
) as Record<string, GenerationNode>;

export interface RunGenerationOptions {
  deps: GraphDeps;
  checkpointer?: BaseCheckpointSaver;
  input: {
    universeId: string;
    locale: UiLocale;
    themes: WorldThemes;
    characters: CharacterSheet[];
    works: string[];
    flavour: Flavour;
  };
  signal?: AbortSignal;
  // Appele quand un noeud a fini, pour suivre l'avancement.
  onStep?: (step: GenerationNode | 'validation') => void;
}

export interface GenerationOutcome {
  charter: WorldCharter;
  bible: WorldBible;
  usage: JsonUsage[];
}

/*
  Une generation complete. Le checkpointer est injecte : le graphe vit dans ce
  paquet, sa persistance appartient au worker, et narrator ne connait pas
  Postgres.

  Le fil de reprise est l'identifiant de l'univers : relancer une generation
  interrompue repart du noeud suivant, pas du debut.
*/
export async function runGeneration(
  options: RunGenerationOptions,
): Promise<GenerationOutcome> {
  const graph = buildGenerationGraph(options.deps).compile(
    options.checkpointer ? { checkpointer: options.checkpointer } : undefined,
  );

  const config = {
    configurable: { thread_id: options.input.universeId },
    signal: options.signal,
    // Six noeuds, une reprise possible : la limite par defaut de vingt-cinq
    // laisserait une boucle tourner bien au dela de ce qu'on a prevu.
    recursionLimit: 20,
  };

  /*
    Reprendre un fil, et non en ouvrir un second : c'est `null` en entree qui
    dit de continuer, une entree complete faisant repartir du debut meme quand
    un checkpoint existe. `next` vide signale un fil absent ou acheve, et on
    repart alors de l'entree.
  */
  const resuming =
    options.checkpointer !== undefined &&
    (await graph.getState(config)).next.length > 0;

  // En flux plutot qu'en un seul appel : c'est ce qui permet de dire ou en est
  // la generation. Les deux modes ensemble, parce que `updates` nomme le noeud
  // qui vient de finir et `values` porte l'etat complet.
  let state: GenerationStateType | undefined;

  for await (const chunk of await graph.stream(
    resuming ? null : { ...options.input, rewrites: 0 },
    { ...config, streamMode: ['updates', 'values'] },
  )) {
    const [mode, data] = chunk as [string, unknown];

    if (mode === 'values') {
      state = data as GenerationStateType;
      continue;
    }

    for (const name of Object.keys(data as Record<string, unknown>)) {
      const step = name === 'validation' ? 'validation' : STEP_OF[name];
      if (step) options.onStep?.(step);
    }
  }

  if (!state) throw new GenerationFailure('validation', ['aucun etat produit']);

  /*
    Troisieme liste de cles recopiee, apres celles du flux et de l'ecran, et
    la seule qui ait fait des degats : le noeud d'arc tournait, `validate`
    l'acceptait, et l'assemblage le jetait. Un monde a ete genere sans
    histoire pour cette ligne.
  */
  const bible = WorldBibleSchema.parse({
    lore: state.lore,
    factions: state.factions,
    politics: state.politics,
    npcs: state.npcs,
    affinities: state.affinities,
    arc: state.arc,
  });

  return {
    charter: WorldCharterSchema.parse(state.charter),
    bible,
    usage: state.usage,
  };
}
