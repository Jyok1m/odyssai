import { z } from 'zod';
import { IncarnationSchema, MarksSchema } from './essence.js';
import {
  ArrivalSchema,
  AttributeSchema,
  AttributesSchema,
  GenerationStepSchema,
  normalizeWorkTitle,
} from './onboarding.js';

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
  Ce que chaque theme peut faire de long, en caracteres.

  Nomme ici et non ecrit en clair dans le schema, parce que le prompt doit les
  dire au modele : il ne respecte pas une borne qu'il ignore, et une
  generation a echoue sur un `setting` trop long faute de la connaitre. Les
  recopier dans le prompt en ferait deux verites, et la fausse serait celle
  que le modele lit.
*/
export const THEME_LIMITS = {
  tone: 200,
  setting: 400,
  power: 400,
  mystery: 400,
  tension: 200,
  motif: 120,
  forbidden: 120,
} as const;

/*
  Une borne en caracteres, dite au modele en mots.

  Mesure sur `qwen3.7-plus` : une borne donnee en caracteres lui sert de
  cible et il la depasse d'un dixieme (geography 1335 pour 1200, era 379 pour
  300). Il compte les mots bien mieux que les caracteres, et huit caracteres
  par mot laissent la marge qui absorbe ce depassement : cent cinquante mots
  de francais font mille a mille cent caracteres, jamais mille deux cents.
*/
export const CHARS_PER_WORD = 8;

export function wordsWithin(chars: number): number {
  return Math.floor(chars / CHARS_PER_WORD);
}

/*
  Sortie de la passe d'abstraction, et seule chose que les etapes suivantes de
  la generation recoivent. Les titres saisis s'arretent avant.
*/
export const WorldThemesSchema = z.object({
  // Le ton dominant, ce que le monde fait ressentir.
  tone: Prose(THEME_LIMITS.tone),
  // Le cadre physique : ou l'on est, de quoi c'est fait.
  setting: Prose(THEME_LIMITS.setting),
  // Comment le pouvoir se tient, et sur quoi il repose.
  power: Prose(THEME_LIMITS.power),
  // Ce qui echappe a l'explication, et jusqu'ou.
  mystery: Prose(THEME_LIMITS.mystery),
  // Les lignes de fracture dont naissent les histoires.
  tensions: z.array(Prose(THEME_LIMITS.tension)).min(2).max(5),
  // Les motifs qui reviennent : objets, gestes, lieux.
  motifs: z.array(Prose(THEME_LIMITS.motif)).min(3).max(8),
  // Ce que ce monde ne contient pas. Aussi structurant que le reste.
  forbidden: z.array(Prose(THEME_LIMITS.forbidden)).min(1).max(5),
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
  Ce que chaque champ genere peut faire de long, en caracteres, noeud par
  noeud. Meme raison que THEME_LIMITS : le prompt de chaque noeud les dit au
  modele. La charte a echoue deux fois de suite sur un `allowed` de plus de
  deux cents caracteres, la doctrine lui demandant d'ecrire chaque chose
  « avec sa regle » sans jamais dire la place qu'elle avait pour cela.
*/
export const GENERATION_LIMITS = {
  charter: { premise: 600, tone: 300, allowed: 200, forbidden: 200, narratorRule: 200 },
  lore: { era: 300, geography: 1200, history: 1200, dailyLife: 1200 },
  faction: { creed: 400, strength: 300, territory: 300, symbol: 200 },
  politics: { balance: 800, conflict: 400, stakes: 600 },
  npc: { role: 200, drive: 300, secret: 400 },
  affinity: { note: 300 },
  arc: { hook: 400, stakes: 400, title: 60, goal: 300, done: 200, bond: 300, secret: 300 },
} as const;

/*
  Ce qui existe ou non dans ce monde, et comment il se raconte. Le narrateur la
  respecte en toutes circonstances : c'est elle qui empeche un monde sans magie
  d'en voir apparaitre au troisieme tour.
*/
export const WorldCharterSchema = z.object({
  premise: Text(GENERATION_LIMITS.charter.premise),
  tone: Text(GENERATION_LIMITS.charter.tone),
  // Ce que ce monde rend possible.
  allowed: z.array(Text(GENERATION_LIMITS.charter.allowed)).min(2).max(8),
  // Ce qu'il ne contient pas. Aussi structurant que le reste.
  forbidden: z.array(Text(GENERATION_LIMITS.charter.forbidden)).min(2).max(8),
  // Consignes de narration propres a ce monde.
  narratorRules: z.array(Text(GENERATION_LIMITS.charter.narratorRule)).min(2).max(6),
});

export type WorldCharter = z.infer<typeof WorldCharterSchema>;

export const WorldLoreSchema = z.object({
  name: Name,
  era: Text(GENERATION_LIMITS.lore.era),
  geography: Text(GENERATION_LIMITS.lore.geography),
  history: Text(GENERATION_LIMITS.lore.history),
  dailyLife: Text(GENERATION_LIMITS.lore.dailyLife),
  // Teinte de l'accent, que l'interface applique en entrant dans ce monde.
  accentHue: z.number().int().min(0).max(359),
});

export type WorldLore = z.infer<typeof WorldLoreSchema>;

export const FactionSchema = z.object({
  name: Name,
  creed: Text(GENERATION_LIMITS.faction.creed),
  strength: Text(GENERATION_LIMITS.faction.strength),
  territory: Text(GENERATION_LIMITS.faction.territory),
  symbol: Text(GENERATION_LIMITS.faction.symbol),
});

export type Faction = z.infer<typeof FactionSchema>;

export const PoliticsSchema = z.object({
  balance: Text(GENERATION_LIMITS.politics.balance),
  conflicts: z.array(Text(GENERATION_LIMITS.politics.conflict)).min(1).max(4),
  stakes: Text(GENERATION_LIMITS.politics.stakes),
});

export type Politics = z.infer<typeof PoliticsSchema>;

export const NpcSchema = z.object({
  name: Name,
  role: Text(GENERATION_LIMITS.npc.role),
  // Nom d'une faction existante, ou null pour un independant.
  faction: Name.nullable(),
  drive: Text(GENERATION_LIMITS.npc.drive),
  // Ce que le joueur ignore encore. Jamais rendu a l'ecran tel quel.
  secret: Text(GENERATION_LIMITS.npc.secret),
});

export type Npc = z.infer<typeof NpcSchema>;

export const AffinitySchema = z.object({
  subject: Name,
  target: Name,
  stance: z.enum(['allie', 'rival', 'neutre', 'dette', 'haine']),
  note: Text(GENERATION_LIMITS.affinity.note),
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
  Ce que le monde sait du heros lui-meme : un lien, qui le rattache a cette
  histoire et qu'il connait ; un secret, qu'il ne connait pas encore et que le
  meneur garde. Genere avec l'arc, parce que l'un et l'autre doivent tenir
  avec la meme histoire.
*/
export const HeroLoreSchema = z.object({
  bond: Text(GENERATION_LIMITS.arc.bond),
  secret: Text(GENERATION_LIMITS.arc.secret),
});
export type HeroLore = z.infer<typeof HeroLoreSchema>;

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
  /*
    Le nom de l'acte, et la seule part de l'arc que le joueur voit.

    Il nomme la situation qu'on traverse, jamais sa resolution : « Le phare
    sans gardien », pas « Retrouver le gardien ». Facultatif pour la meme
    raison que l'arc lui-meme, les mondes generes avant n'en ayant pas.
  */
  title: Text(GENERATION_LIMITS.arc.title).optional(),
  // Ce vers quoi cet acte tend.
  goal: Text(GENERATION_LIMITS.arc.goal),
  // A quoi on reconnait qu'il est acheve.
  done: Text(GENERATION_LIMITS.arc.done),
});

export type ArcAct = z.infer<typeof ArcActSchema>;

export const WorldArcSchema = z.object({
  // La situation d'ouverture, celle ou le joueur arrive.
  hook: Text(GENERATION_LIMITS.arc.hook),
  // Ce qui pousse, et ce que cela coute de ne rien faire.
  stakes: Text(GENERATION_LIMITS.arc.stakes),
  acts: z.tuple([ArcActSchema, ArcActSchema, ArcActSchema]),
  // Facultatif pour la meme raison que l'arc lui-meme : un arc d'avant.
  hero: HeroLoreSchema.optional(),
});

export type WorldArc = z.infer<typeof WorldArcSchema>;

/*
  Ce que le monde sait d'une personne, d'un objet, d'un lieu ou d'une faction,
  en deux parts : `known`, ce que le joueur a appris, et `hidden`, ce que le
  meneur garde jusqu'a ce que le jeu le revele.

  C'est la matiere qui grandit. La bible est ecrite une fois ; les entites
  naissent d'elle a la generation, puis de chaque nom nouveau que le meneur
  pose en jeu, et chacune recoit son fragment de lore, coherent avec le reste.
  Un personnage rencontre au dixieme tour a une histoire comme ceux du
  premier.

  Les genres sont sans accent : le modele les recopie.
*/
export const CANON_FACTS_PER_TURN_MAX = 3;

/*
  Un fait que le meneur a invente en repondant a une question que le lore ne
  couvrait pas. Il entre au canon et nourrit tous les tours suivants : c'est
  ce qui fait qu'une reponse donnee une fois reste vraie.
*/
export const CanonFactSchema = z.object({
  // De quoi ca parle, en quelques mots. Sert a relire et a regrouper.
  subject: z.string().trim().min(2).max(80),
  statement: z.string().trim().min(10).max(400),
});

export type CanonFact = z.infer<typeof CanonFactSchema>;

export const ENTITY_KINDS = ['npc', 'item', 'place', 'faction'] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const ENTITY_TEXT_MAX = 400;

// Ce que le modele produit pour une entite nouvelle.
export const LoreFragmentSchema = z.object({
  known: Text(ENTITY_TEXT_MAX),
  hidden: Text(ENTITY_TEXT_MAX),
});
export type LoreFragment = z.infer<typeof LoreFragmentSchema>;

export const EntitySchema = z.object({
  name: Name,
  kind: EntityKindSchema,
  // Grandit a chaque revelation : le cache y est reverse quand il sort.
  known: z.string().trim().min(1).max(ENTITY_TEXT_MAX * 4),
  hidden: z.string().trim().min(1).max(ENTITY_TEXT_MAX).nullable(),
});
export type Entity = z.infer<typeof EntitySchema>;

// Ce que le joueur voit : jamais le cache, et c'est le type qui le garantit.
export const PublicEntitySchema = EntitySchema.omit({ hidden: true });
export type PublicEntity = z.infer<typeof PublicEntitySchema>;

/*
  Le nom replie, pour l'unicite : le meneur ecrit « l'Epee » la ou il avait
  ecrit « epee corrompue », et « Soeur Nym » la ou la bible dit « Sœur Nym ».
  Meme repli que les titres d'oeuvres, pour la meme raison.
*/
export function entityKey(name: string): string {
  return normalizeWorkTitle(name);
}


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

/*
  Ou en est un attribut, calcule par le serveur.

  Le modificateur et les paliers vivent dans `@odyssai/engine`, que le
  navigateur n'a pas : les recopier la-bas en ferait deux verites, et la
  fausse serait celle qu'on lit a l'ecran. `needed` est nul au maximum, ou
  rien n'attend plus.
*/
export const AttributeStandingSchema = z.object({
  score: z.number().int(),
  modifier: z.number().int(),
  // Jets depuis la derniere montee, pas depuis toujours.
  uses: z.number().int().nonnegative(),
  needed: z.number().int().positive().nullable(),
});

export type AttributeStanding = z.infer<typeof AttributeStandingSchema>;

/*
  Dans quel etat le personnage se tient.

  Le joueur voit la jauge, le meneur ne voit que ce mot : c'est la meme regle
  que le de, ou le modele recoit une bande et jamais un chiffre. Un meneur qui
  lirait « 7 sur 16 » narrerait une comptabilite ; avec « mal en point », il
  narre quelqu'un qui tient a peine debout.

  Sans accent, comme les autres valeurs que le modele recopie.
*/
export const CONDITIONS = ['indemne', 'blesse', 'mal_en_point', 'a_terre'] as const;
export const ConditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof ConditionSchema>;

export const HealthSchema = z.object({
  hp: z.number().int().nonnegative(),
  hpMax: z.number().int().positive(),
  condition: ConditionSchema,
});

export type Health = z.infer<typeof HealthSchema>;

/*
  Ou en est l'histoire, vue du joueur : le rang de l'acte, jamais son but ni
  son signe de fin. Le meneur lui-meme ne recoit que l'acte en cours, pour
  qu'une histoire qui sait ou elle va ne se raconte pas toute seule.

  `bond` est ce qui rattache le heros a cette histoire et qu'il sait. Le
  secret, que le monde sait de lui et qu'il ignore, reste au meneur : il n'est
  pas dans ce type, donc il ne peut pas fuiter.
*/
export const StoryStandingSchema = z.object({
  act: z.number().int().min(1).nullable(),
  acts: z.number().int().nonnegative(),
  /*
    Le nom de l'acte en cours, et lui seul : les titres des actes a venir
    diraient deja ou va l'histoire. Nul pour un monde genere avant les titres,
    et une fois l'arc clos.
  */
  title: z.string().nullable(),
  bond: z.string().nullable(),
});

export type StoryStanding = z.infer<typeof StoryStandingSchema>;

export const WorldViewSchema = z.object({
  name: z.string(),
  accentHue: z.number().int().min(0).max(359),
  charter: WorldCharterSchema,
  lore: WorldLoreSchema,
  factions: z.array(FactionSchema),
  politics: PoliticsSchema,
  npcs: z.array(PublicNpcSchema),
  affinities: z.array(AffinitySchema),
  // Ce que le joueur a appris, entite par entite. Le cache n'est pas dans le type.
  entities: z.array(PublicEntitySchema),
  /*
    Ce que le meneur a invente en repondant a une question que le lore ne
    couvrait pas. Il se lit avec le monde et non avec l'historique d'un tour :
    une reponse donnee une fois reste vraie.
  */
  canon: z.array(CanonFactSchema),
  story: StoryStandingSchema,
  character: z.object({
    name: z.string(),
    gender: z.string(),
    age: z.number().int(),
    personality: z.object({
      traits: z.array(z.string()),
      summary: z.string(),
    }),
    attributes: AttributesSchema,
    standing: z.record(AttributeSchema, AttributeStandingSchema),
    health: HealthSchema,
    talents: z.array(z.string()),
    inventory: z.array(z.string()),
    // Comment il est entre dans ce monde : il y est ne, ou il y est venu.
    arrival: ArrivalSchema,
    /*
      Ce qu'il a rapporte de ses mondes. Sur l'essence et non sur
      l'incarnation : c'est ce qui traverse.
    */
    marks: MarksSchema,
    /*
      Les autres mondes ou la meme essence s'est posee. Vide pour un
      personnage qui n'a jamais franchi de faille, et c'est le cas ordinaire.
    */
    elsewhere: z.array(IncarnationSchema),
  }),
});

export type WorldView = z.infer<typeof WorldViewSchema>;

/*
  Un monde qu'un autre joueur a ouvert, vu du dehors.

  Ce qu'il en montre est ce qu'on met sur une porte : de quoi decider si on
  entre. Ni factions, ni personnages, ni canon, ni arc : le visiteur les
  decouvrira en jouant, ou pas du tout. C'est le type qui le garantit, comme
  pour le secret des personnages.

  Le pseudo de l'hote y figure : c'est exactement ce pour quoi il existe, etre
  vu des autres joueurs quand les univers se croisent.
*/
export const OpenWorldSchema = z.object({
  universeId: z.uuid(),
  name: z.string(),
  accentHue: z.number().int().min(0).max(359),
  premise: z.string(),
  tone: z.string(),
  host: z.string().nullable(),
});

export type OpenWorld = z.infer<typeof OpenWorldSchema>;

export const OpenWorldsSchema = z.object({
  worlds: z.array(OpenWorldSchema),
});

export type OpenWorlds = z.infer<typeof OpenWorldsSchema>;

export const WorldErrorBodySchema = z.object({
  // `not_ready` dit que le monde n'est pas encore genere, pas qu'il manque.
  code: z.enum(['not_ready', 'not_found']),
});

export type WorldErrorBody = z.infer<typeof WorldErrorBodySchema>;
