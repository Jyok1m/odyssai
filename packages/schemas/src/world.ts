import { z } from 'zod';
import { GenerationStepSchema, normalizeWorkTitle } from './onboarding.js';

/*
  Une majuscule hors tete de phrase vaut nom propre. La regle est grossiere et
  se trompe dans le sens du refus : une relance coute moins qu'un monde
  emprunte. L'apostrophe separe les mots, sans quoi « l'Ordre » passerait pour
  un mot commencant par une minuscule.
*/
const SENTENCE_BREAK = /[.!?…:;]+\s+|\n+/;
const WORD = /\p{L}[\p{L}\p{M}-]*/gu;

export function findProperNouns(text: string): string[] {
  const found = new Set<string>();

  for (const sentence of text.split(SENTENCE_BREAK)) {
    const words = sentence.match(WORD) ?? [];

    words.forEach((word, index) => {
      // En tete de phrase la majuscule ne dit rien.
      if (index === 0) return;
      if (word.length < 2) return;
      if (!/^\p{Lu}/u.test(word)) return;
      found.add(word);
    });
  }

  return [...found];
}

/*
  Mots de liaison assez longs pour passer le filtre de longueur sans rien
  designer. Les plus courts tombent d'eux-memes.
*/
const WEAK_WORDS = new Set([
  'dans', 'avec', 'pour', 'sans', 'sous', 'chez', 'entre', 'leur', 'leurs',
  'cette', 'celui', 'celle', 'tout', 'tous', 'toute', 'toutes', 'plus',
  'from', 'with', 'that', 'this', 'into', 'over', 'under', 'their', 'they',
  'other', 'more', 'have', 'been', 'were', 'what', 'when', 'where',
]);

function significantWords(title: string): string[] {
  return normalizeWorkTitle(title)
    .split(' ')
    .filter((word) => word.length >= 4 && !WEAK_WORDS.has(word));
}

/*
  Dernier etage de la garde : relit un texte genere contre les titres saisis.
  Seuls les mots capitalises sont compares, sinon un monde desertique inspire
  de Dune ne pourrait plus parler de dunes.

  Elle attrape les noms, pas les intrigues : c'est l'abstraction qui porte
  cette part la, en ne transmettant que des themes.
*/
export function findBorrowedNames(text: string, works: string[]): string[] {
  const banned = new Map<string, string>();
  for (const title of works) {
    for (const word of significantWords(title)) banned.set(word, title);
  }

  const borrowed = new Set<string>();

  for (const word of text.match(WORD) ?? []) {
    if (!/^\p{Lu}/u.test(word)) continue;
    if (banned.has(normalizeWorkTitle(word))) borrowed.add(word);
  }

  /*
    Un titre entier recopie, meme en minuscules, n'est pas une coincidence. Les
    titres d'un seul mot en sont exclus : « dune » est aussi un mot commun, et
    le refuser interdirait a un monde desertique de parler de sable.

    La comparaison porte sur des mots entiers, jamais sur des sous-chaines.
  */
  const haystack = ` ${normalizeWorkTitle(text)} `;
  for (const title of works) {
    const needle = normalizeWorkTitle(title);
    if (needle.includes(' ') && haystack.includes(` ${needle} `)) {
      borrowed.add(title);
    }
  }

  return [...borrowed];
}

// Prose sans nom propre : c'est l'etage du schema, pas celui du prompt.
const Prose = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine((value) => findProperNouns(value).length === 0, {
      message: 'aucun nom propre',
    });

/*
  Sortie de la passe d'abstraction, et seule chose que les etapes suivantes de
  la generation recoivent. Les titres saisis s'arretent avant.
*/
export const WorldThemesSchema = z.object({
  // Le ton dominant, ce que le monde fait ressentir.
  tone: Prose(200),
  // Le cadre physique : ou l'on est, de quoi c'est fait.
  setting: Prose(400),
  // Comment le pouvoir se tient, et sur quoi il repose.
  power: Prose(400),
  // Ce qui echappe a l'explication, et jusqu'ou.
  mystery: Prose(400),
  // Les lignes de fracture dont naissent les histoires.
  tensions: z.array(Prose(200)).min(2).max(5),
  // Les motifs qui reviennent : objets, gestes, lieux.
  motifs: z.array(Prose(120)).min(3).max(8),
  // Ce que ce monde ne contient pas. Aussi structurant que le reste.
  forbidden: z.array(Prose(120)).min(1).max(5),
});

export type WorldThemes = z.infer<typeof WorldThemesSchema>;

// Toute la prose des themes, mise bout a bout pour le controle final.
export function themesProse(themes: WorldThemes): string {
  return [
    themes.tone,
    themes.setting,
    themes.power,
    themes.mystery,
    ...themes.tensions,
    ...themes.motifs,
    ...themes.forbidden,
  ].join('\n');
}

// Prose de monde. Les noms propres y sont attendus : ce sont ceux du monde.
const Text = (max: number) => z.string().trim().min(3).max(max);

const Name = z.string().trim().min(2).max(80);

/*
  Ce qui existe ou non dans ce monde, et comment il se raconte. Le narrateur la
  respecte en toutes circonstances : c'est elle qui empeche un monde sans magie
  d'en voir apparaitre au troisieme tour.
*/
export const WorldCharterSchema = z.object({
  premise: Text(600),
  tone: Text(300),
  // Ce que ce monde rend possible.
  allowed: z.array(Text(200)).min(2).max(8),
  // Ce qu'il ne contient pas. Aussi structurant que le reste.
  forbidden: z.array(Text(200)).min(2).max(8),
  // Consignes de narration propres a ce monde.
  narratorRules: z.array(Text(200)).min(2).max(6),
});

export type WorldCharter = z.infer<typeof WorldCharterSchema>;

export const WorldLoreSchema = z.object({
  name: Name,
  era: Text(300),
  geography: Text(1200),
  history: Text(1200),
  dailyLife: Text(1200),
  // Teinte de l'accent, que l'interface applique en entrant dans ce monde.
  accentHue: z.number().int().min(0).max(359),
});

export type WorldLore = z.infer<typeof WorldLoreSchema>;

export const FactionSchema = z.object({
  name: Name,
  creed: Text(400),
  strength: Text(300),
  territory: Text(300),
  symbol: Text(200),
});

export type Faction = z.infer<typeof FactionSchema>;

export const PoliticsSchema = z.object({
  balance: Text(800),
  conflicts: z.array(Text(400)).min(1).max(4),
  stakes: Text(600),
});

export type Politics = z.infer<typeof PoliticsSchema>;

export const NpcSchema = z.object({
  name: Name,
  role: Text(200),
  // Nom d'une faction existante, ou null pour un independant.
  faction: Name.nullable(),
  drive: Text(300),
  // Ce que le joueur ignore encore. Jamais rendu a l'ecran tel quel.
  secret: Text(400),
});

export type Npc = z.infer<typeof NpcSchema>;

export const AffinitySchema = z.object({
  subject: Name,
  target: Name,
  stance: z.enum(['allie', 'rival', 'neutre', 'dette', 'haine']),
  note: Text(300),
});

export type Affinity = z.infer<typeof AffinitySchema>;

/*
  Le monde genere, en JSON valide a l'ecriture comme a la lecture. Les sortir
  en tables propres demanderait de dessiner tout le schema du jeu, ce que ce
  chantier n'a pas a trancher.

  La charte vit a part, dans sa propre colonne : elle est lue a chaque tour de
  jeu, la bible seulement quand le narrateur a besoin du detail.
*/
/*
  L'histoire dans laquelle le heros est parachute.

  Trois actes, un but par acte et le signe qui dit qu'il est acheve : le
  modele a besoin de savoir vers quoi il mene, et le code a besoin d'un critere
  pour avancer sans le croire sur parole.

  Une fois le troisieme acte clos, la partie ne s'arrete pas : elle passe en
  aventure libre et l'histoire continue de s'ecrire au fil de l'eau. Un arc
  donne un depart, il ne donne pas une fin.
*/
export const ArcActSchema = z.object({
  // Ce vers quoi cet acte tend.
  goal: Text(300),
  // A quoi on reconnait qu'il est acheve.
  done: Text(200),
});

export type ArcAct = z.infer<typeof ArcActSchema>;

export const WorldArcSchema = z.object({
  // La situation d'ouverture, celle ou le joueur arrive.
  hook: Text(400),
  // Ce qui pousse, et ce que cela coute de ne rien faire.
  stakes: Text(400),
  acts: z.tuple([ArcActSchema, ArcActSchema, ArcActSchema]),
});

export type WorldArc = z.infer<typeof WorldArcSchema>;

export const WorldBibleSchema = z.object({
  lore: WorldLoreSchema,
  factions: z.array(FactionSchema).min(2).max(5),
  politics: PoliticsSchema,
  npcs: z.array(NpcSchema).min(3).max(6),
  affinities: z.array(AffinitySchema).min(3).max(10),
  /*
    Facultatif : les mondes generes avant cette etape n'en ont pas, et une
    bible que le schema refuserait rendrait leur partie injouable. Sans arc,
    le meneur joue comme il jouait.
  */
  arc: WorldArcSchema.optional(),
});

export type WorldBible = z.infer<typeof WorldBibleSchema>;

// Toute la prose du monde, pour le controle final contre les titres saisis.
export function bibleProse(charter: WorldCharter, bible: WorldBible): string {
  return [
    charter.premise,
    charter.tone,
    ...charter.allowed,
    ...charter.forbidden,
    ...charter.narratorRules,
    bible.lore.name,
    bible.lore.era,
    bible.lore.geography,
    bible.lore.history,
    bible.lore.dailyLife,
    ...bible.factions.flatMap((faction) => [
      faction.name,
      faction.creed,
      faction.strength,
      faction.territory,
      faction.symbol,
    ]),
    bible.politics.balance,
    ...bible.politics.conflicts,
    bible.politics.stakes,
    ...bible.npcs.flatMap((npc) => [npc.name, npc.role, npc.drive, npc.secret]),
    ...bible.affinities.flatMap((affinity) => [
      affinity.subject,
      affinity.target,
      affinity.note,
    ]),
  ].join('\n');
}

/*
  Essais par noeud du graphe de generation. Un modele rate rarement deux fois
  de la meme facon, et un troisieme essai coute plus qu'il ne rattrape.

  Ici plutot que dans narrator : c'est un reglage, et `@odyssai/engine` en
  tient l'index pour qu'aucun bouton ne se cache dans un paquet.
*/
export const GENERATION_ATTEMPTS_PER_NODE = 2;

/*
  Reprises du lore apres un nom emprunte detecte par le controle final. Au
  dela, la generation echoue : une boucle qui insiste couterait sept appels de
  plus sans garantie de converger.
*/
export const GENERATION_REWRITES_MAX = 1;

/*
  File de generation, partagee par l'api qui publie et le worker qui consomme.
  Le nom et la forme du travail sont un contrat : les laisser chacun de son
  cote ferait deux verites, et une faute de frappe passerait inapercue.
*/
// BullMQ refuse les deux points : ils separent ses propres cles Redis.
export const GENERATION_QUEUE = 'odyssai-generation';

/*
  Le travail ne porte que l'identifiant de l'univers. Tout le reste se relit en
  base : une charge utile qui embarquerait la fiche vieillirait dans la file,
  et un joueur qui corrige sa saisie verrait generer l'ancienne.
*/
export const GenerationJobDataSchema = z.object({
  universeId: z.uuid(),
});

export type GenerationJobData = z.infer<typeof GenerationJobDataSchema>;

// Evenements du flux d'avancement, un objet JSON par ligne `data:`.
export const GenerationStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    status: z.enum(['queued', 'running']),
    /*
      La liste etait recopiee ici, et `arc` l'a prise en defaut : une etape
      ajoutee au graphe ne se voyait pas dans le flux. Une valeur n'a qu'une
      definition, et c'est celle du schema partage.
    */
    step: GenerationStepSchema.nullable(),
    attempts: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('ready'), name: z.string() }),
  z.object({ type: z.literal('failed'), error: z.string().nullable() }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['internal_error', 'timeout']),
  }),
]);

export type GenerationStreamEvent = z.infer<typeof GenerationStreamEventSchema>;

/*
  Ce que le navigateur recoit du monde.

  Les secrets des personnages n'y sont pas, et c'est le schema qui le garantit
  plutot qu'un `delete` cote serveur : un champ qu'un type ne porte pas ne peut
  pas fuiter par distraction. Ils se decouvriront en jeu.
*/
export const PublicNpcSchema = NpcSchema.omit({ secret: true });

export type PublicNpc = z.infer<typeof PublicNpcSchema>;

export const WorldViewSchema = z.object({
  name: z.string(),
  accentHue: z.number().int().min(0).max(359),
  charter: WorldCharterSchema,
  lore: WorldLoreSchema,
  factions: z.array(FactionSchema),
  npcs: z.array(PublicNpcSchema),
  affinities: z.array(AffinitySchema),
  character: z.object({
    name: z.string(),
    gender: z.string(),
    age: z.number().int(),
    personality: z.object({
      traits: z.array(z.string()),
      summary: z.string(),
    }),
    attributes: z.record(z.string(), z.number().int()),
  }),
});

export type WorldView = z.infer<typeof WorldViewSchema>;

export const WorldErrorBodySchema = z.object({
  // `not_ready` dit que le monde n'est pas encore genere, pas qu'il manque.
  code: z.enum(['not_ready', 'not_found']),
});

export type WorldErrorBody = z.infer<typeof WorldErrorBodySchema>;
