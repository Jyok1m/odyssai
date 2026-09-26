import { z } from 'zod';
import { MarkKindSchema } from './essence.js';
import { AttributeSchema } from './onboarding.js';
/*
  Le canon vit avec le monde, pas avec le tour : il dit ce qui est vrai ici, et
  c'est le tour qui le fait grandir. Importe plutot que redefini, sans quoi la
  borne du bloc de queue et celle du monde finiraient par diverger.
*/
import {
  CANON_FACTS_PER_TURN_MAX,
  CanonFactSchema,
  ConditionSchema,
  EntityKindSchema,
} from './world.js';

export const TURN_MESSAGE_MAX_CHARS = 600;

// Au dela, le meneur invente plus qu'il ne repond.
/*
  Ce qu'un personnage porte, au plus. Un sac, pas un entrepot : au dela, le
  meneur decrirait un inventaire que personne ne relit, et chaque tour le lui
  renverrait en entier.
*/
export const INVENTORY_MAX = 10;

// Ce qui peut changer de main en un tour, dans chaque sens.
export const ITEMS_PER_TURN_MAX = 3;

/*
  Combien d'entites nouvelles un tour peut faire naitre. Chacune coute un
  appel de plus et un credit : deux suffisent a une scene, et un meneur qui en
  poserait cinq d'un coup ferait ce qu'on lui reproche deja.
*/
export const ENTITIES_PER_TURN_MAX = 2;

/*
  Ce que le joueur envoie. Deux formes seulement : il dit ce qu'il fait ou
  demande, ou il s'en remet au sort quand il ne sait pas quoi faire.
*/
export const TurnRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('say'),
    content: z.string().trim().min(1).max(TURN_MESSAGE_MAX_CHARS),
  }),
  z.object({ kind: z.literal('fate') }),
  /*
    La premiere scene, jouee par le meneur sans que le joueur ait rien dit.

    Sans elle le joueur arrive devant un champ vide et doit deviner qu'il
    commence : c'est le meneur qui ouvre une partie, pas celui qui la joue.
    L'api la refuse des qu'un tour existe, sinon elle se rejouerait a chaque
    rechargement, et chaque fois pour un credit.
  */
  z.object({ kind: z.literal('open') }),
  /*
    Le second temps d'une action que le de doit trancher.

    Il ne porte rien : ce que le joueur a ecrit attend en Redis depuis le
    premier temps. Le lui faire renvoyer reviendrait a le croire sur parole,
    et rien ne l'empecherait de changer sa phrase entre le jet demande et le
    jet lance.
  */
  z.object({ kind: z.literal('roll') }),
  /*
    Une question posee au meneur, hors de l'action.

    Le joueur ne tente rien : il demande de quoi se reperer. Le de ne sert
    donc pas, la scene n'avance pas, et le meneur repond avec ce que le lore
    contient. Ce qu'il invente pour repondre entre au canon comme le reste :
    c'est lui qui decide, et une reponse donnee une fois reste vraie.
  */
  z.object({
    kind: z.literal('ask'),
    content: z.string().trim().min(1).max(TURN_MESSAGE_MAX_CHARS),
  }),
]);

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

// Ce que le joueur a envoye, tel que la reponse du meneur le porte ensuite.
export const TURN_REQUEST_KINDS = ['say', 'ask', 'fate', 'roll', 'open'] as const;
export const TurnRequestKindSchema = z.enum(TURN_REQUEST_KINDS);
export type TurnRequestKind = z.infer<typeof TurnRequestKindSchema>;

/*
  Ce que le joueur apprend du de : deux etats, et seulement quand l'issue
  etait incertaine. Le chiffre ne sort jamais du serveur, et une question sur
  le lore ne se tranche pas au de, donc `null` y est la bonne reponse.
*/
export const PublicOutcomeSchema = z.enum(['favorable', 'defavorable']);

export type PublicOutcome = z.infer<typeof PublicOutcomeSchema>;

/*
  Le bloc rendu par le modele en queue de reponse. Le code s'en sert pour
  savoir quoi ecrire ; le joueur, lui, a deja tout lu dans la prose.
*/
export const TurnDeltaSchema = z.object({
  kind: z.enum(['action', 'question']),
  facts: z.array(CanonFactSchema).max(CANON_FACTS_PER_TURN_MAX).default([]),
  /*
    Ce que le personnage vient de prendre et de perdre.

    Des noms, et rien d'autre : un objet n'a pas d'effet chiffre. Le meneur le
    raconte, le moteur ne le calcule pas. Sinon « je fabrique une epee qui tue
    tout » serait obei, et l'etat du jeu se deciderait dans la prose.
  */
  /*
    Vrai quand ce que le meneur vient de raconter acheve l'acte en cours.

    Le code n'avance que d'un cran et ne recule jamais : une declaration ne
    doit pas pouvoir sauter la moitie d'une histoire, ni la rejouer.
  */
  actDone: z.boolean().default(false),
  /*
    Les noms nouveaux que le meneur vient de poser, avec ce que la scene en a
    montre. Le code leur donne un lore, coherent avec le monde : un
    personnage rencontre au dixieme tour a une histoire comme ceux du premier.
  */
  met: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        kind: EntityKindSchema,
        hint: z.string().trim().min(3).max(300),
      }),
    )
    .max(ENTITIES_PER_TURN_MAX)
    .default([]),
  // Les entites dont le cache vient de sortir dans le recit, par leur nom.
  revealed: z.array(z.string().trim().min(2).max(80)).max(3).default([]),
  gained: z.array(z.string().trim().min(2).max(60)).max(ITEMS_PER_TURN_MAX).default([]),
  lost: z.array(z.string().trim().min(2).max(60)).max(ITEMS_PER_TURN_MAX).default([]),
});

export type TurnDelta = z.infer<typeof TurnDeltaSchema>;

/*
  Qui et quoi se tient dans la scene, d'apres les noms que le meneur vient de
  poser. Le su seulement, comme le codex : rien de cache ne passe par la.
*/
export const ScenePresenceSchema = z.object({
  name: z.string(),
  kind: EntityKindSchema,
});

export type ScenePresence = z.infer<typeof ScenePresenceSchema>;

// Evenements du flux SSE, un objet JSON par ligne `data:`.
export const TurnStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  /*
    Premier temps : l'action se tranche au de, rien n'est encore genere et
    rien n'est debite. Le flux se ferme la-dessus, et l'ecran demande le jet.
  */
  z.object({ type: z.literal('roll_required') }),
  /*
    Second temps : le jet, avant le premier mot du recit.

    Le chiffre sort du serveur, contrairement a ce qui valait jusqu'ici : le
    joueur lance, donc il voit. La bande, elle, reste interne : cinq nuances
    servent a nuancer un recit, pas a etre lues.
  */
  /*
    Un attribut vient de monter. A part de `done` parce que c'est une nouvelle
    en soi : elle se lit une fois, la ou le verdict d'un tour se lit avec le
    tour.
  */
  // Un lore nouveau ou revele, pour que l'ecran le dise.
  z.object({
    type: z.literal('lore'),
    name: z.string(),
    kind: EntityKindSchema,
    known: z.string(),
  }),
  /*
    L'etat du personnage apres le tour, envoye seulement quand il a bouge.

    Le joueur voit la jauge ; le meneur, lui, n'a recu qu'un mot. `harm` dit
    ce que ce tour a coute, pour que l'ecran l'annonce plutot que de le
    deduire d'une difference.
  */
  z.object({
    type: z.literal('health'),
    hp: z.number().int().nonnegative(),
    hpMax: z.number().int().positive(),
    condition: ConditionSchema,
    harm: z.number().int().nonnegative(),
  }),
  /*
    Qui se tient dans la scene apres ce tour. Derive du recit par le code, et
    non declare par le modele : il oublie ce genre de declaration, et celle-ci
    se verifie en relisant ce qu'il vient d'ecrire.
  */
  z.object({
    type: z.literal('scene'),
    present: z.array(ScenePresenceSchema),
  }),
  // L'inventaire apres le tour, envoye seulement quand il a change.
  z.object({
    type: z.literal('carrying'),
    items: z.array(z.string()),
    /*
      Ce qui vient d'entrer dans le sac, pour que l'ecran le signale. Dit par
      le serveur et non deduit d'une comparaison cote navigateur : c'est
      `carryAfter` qui decide de ce qui est entre, et lui seul replie les noms
      comme il faut.
    */
    gained: z.array(z.string()),
  }),
  /*
    Une marque rapportee. A part de `done` comme la montee d'attribut : c'est
    une nouvelle en soi, qui se lit une fois. Le monde et la date ne sont pas
    dans l'evenement, la fiche les porte deja.
  */
  z.object({
    type: z.literal('mark'),
    kind: MarkKindSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('grew'),
    attribute: AttributeSchema,
    score: z.number().int(),
    /*
      Ce que le nouveau score pese sur un jet. Envoye plutot que recalcule par
      le navigateur : `modifierOf` vit dans `@odyssai/engine`, qu'il n'a pas,
      et la fiche affichee doit suivre la montee sans attendre un
      rechargement.
    */
    modifier: z.number().int(),
    /*
      Ce qu'il faudra de jets pour le palier suivant, nul au maximum. Meme
      raison : `PROGRESS_STEPS` vit dans le moteur, et laisser l'ancienne
      valeur en place afficherait un compte a rebours faux.
    */
    needed: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal('roll'),
    die: z.number().int().min(1),
    /*
      Ce que la fiche ajoute ou retire, et l'attribut qui l'a donne. Le joueur
      lance, donc il voit son jet entier : le chiffre nu sans le bonus ne lui
      dirait pas pourquoi il a reussi.
    */
    modifier: z.number().int(),
    attribute: AttributeSchema.nullable(),
    outcome: PublicOutcomeSchema,
  }),
  z.object({
    type: z.literal('done'),
    // Nul quand le de n'a pas servi : rien a annoncer.
    outcome: PublicOutcomeSchema.nullable(),
    // Nombre de faits entres au canon a ce tour, pour le dire a l'ecran.
    learned: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['upstream_error', 'internal_error']),
  }),
]);

export type TurnStreamEvent = z.infer<typeof TurnStreamEventSchema>;

export const TurnMessageSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /*
    Le nom du personnage qui a parle, dans une partie : le journal se lit
    comme une conversation de groupe, et il faut savoir qui dit quoi. Nul sur
    les reponses du meneur et partout dans une histoire solo.
  */
  author: z.string().nullable(),
  /*
    Le message d'un joueur parti de la table : son rang reste, ses mots non.
    L'ecran dit qu'il a ete retire plutot que de montrer une bulle vide.
  */
  erased: z.boolean(),
  // Porte par la reponse du meneur, jamais par le message du joueur.
  outcome: PublicOutcomeSchema.nullable(),
  /*
    Ce que le joueur a envoye, porte par son message et par la reponse du
    meneur : une question et sa reponse se lisent en aparte, et le recit ne
    les reprend pas, une question n'etant pas une scene.
  */
  request: TurnRequestKindSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type TurnMessage = z.infer<typeof TurnMessageSchema>;

/*
  Un jet lance par le joueur, tel qu'il l'a vu.

  Seuls les tours ou il a lance en portent un : le de tourne a chaque tour,
  mais il n'en voit le chiffre que quand c'est lui qui l'a demande. Le recours
  au sort garde le sien cache, le joueur n'ayant rien tente.
*/
export const RollRecordSchema = z.object({
  die: z.number().int().min(1),
  modifier: z.number().int(),
  attribute: AttributeSchema.nullable(),
  outcome: PublicOutcomeSchema,
});

export type RollRecord = z.infer<typeof RollRecordSchema>;

// Reponse de GET /turn : de quoi reprendre la partie ou on l'a laissee.
export const TurnHistorySchema = z.object({
  messages: z.array(TurnMessageSchema),
  // Ce que le personnage porte, pour que l'ecran le retrouve en revenant.
  inventory: z.array(z.string()),
  /*
    Les faits inventes par le meneur ne sont pas ici : le canon dit ce qui est
    vrai dans ce monde, pas ce qui s'est dit a un tour. Il se lit avec le
    monde, ou il vit a cote de la charte et du lore.
  */
  /*
    Le dernier jet lance, pour que la table le montre encore en revenant.
    Nul tant que le joueur n'a rien lance.
  */
  lastRoll: RollRecordSchema.nullable(),
  // Ce que le meneur a nomme a sa derniere reponse, dans l'ordre du recit.
  scene: z.array(ScenePresenceSchema),
});

export type TurnHistory = z.infer<typeof TurnHistorySchema>;

export const TurnErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    // Le monde n'est pas encore genere.
    'not_ready',
    'rate_limited',
    /*
      Une narration est deja en cours sur cette histoire : le meneur ne
      raconte qu'une scene a la fois, et le journal n'a qu'un rang suivant.
    */
    'busy',
    /*
      La premiere scene existe deja : elle ne se rejoue pas a chaque
      rechargement, chacun ne la paie qu'une fois.
    */
    'already_started',
    // La reserve de credits est epuisee.
    'out_of_credits',
    // Le message a ete refuse par la moderation.
    'refused',
    /*
      L'action qui attendait son jet a vecu plus que son delai, ou le jet a
      deja ete lance. Le joueur reecrit ce qu'il voulait faire : rien n'a ete
      debite, et la scene n'a pas bouge.
    */
    'roll_expired',
    'upstream_error',
  ]),
  // Presente sur un refus. Sert a choisir le message, jamais affichee brute.
  reason: z
    .enum(['insulte', 'haine', 'sexuel', 'minorite', 'violence_gratuite'])
    .nullable()
    .optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  // Presents sur un refus pour reserve vide, pour que l'ecran sache quoi dire.
  needed: z.number().int().nonnegative().optional(),
  balance: z.number().int().nonnegative().optional(),
});

export type TurnErrorBody = z.infer<typeof TurnErrorBodySchema>;

/*
  Ce que le joueur vient de faire, lu dans sa seule phrase : ce sont des actes
  de langage, pas des etats de scene. Une situation qui demanderait
  l'historique (la scene s'enlise, il repete la meme action) viendrait du code,
  pas du classificateur, qui ne voit que ce message.

  Sans accent : le prompt qui les cite est en francais accentue, et un modele
  serviable corrigerait `demesure` en `démesure`. Le prompt devra le dire.
*/
export const SituationSchema = z.enum([
  'violence',
  'contrainte',
  'tromperie',
  'echange',
  'interrogation',
  'lore',
  'exploration',
  'entreprise',
  'intimite',
  'demesure',
  'attente',
  'meta',
]);

export type Situation = z.infer<typeof SituationSchema>;

// Au dela, le rappel pese autant que les consignes permanentes du meneur.
export const GUIDANCE_PER_TURN_MAX = 2;

/*
  Combien de temps une action attend son jet. Large pour qu'un rechargement de
  page ou un moment d'absence ne la perde pas, borne pour qu'une action oubliee
  ne revienne pas trancher une scene qui a change.
*/
export const PENDING_ROLL_TTL_SECONDS = 600;


/*
  Verdict de moderation. `reason` n'est jamais rendu au joueur tel quel : il
  sert au journal et a choisir le message affiche.
*/
export const ModerationVerdictSchema = z.object({
  allow: z.boolean(),
  reason: z
    .enum(['insulte', 'haine', 'sexuel', 'minorite', 'violence_gratuite'])
    .nullable()
    .default(null),
  /*
    Code de la langue du message, en deux ou trois lettres. Le classificateur
    lit deja la phrase : la lui demander ne coute rien, la detecter ailleurs
    couterait un appel ou une dependance.

    Pas une enumeration : le joueur peut ecrire dans n'importe quelle langue,
    et seule la distinction « francais ou non » est exploitee.
  */
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/)
    .nullable()
    .default(null),
  /*
    Ce que le joueur vient de faire, pour choisir les fiches de maitrise. Le
    classificateur lit deja la phrase : la lui demander ne coute pas un appel
    de plus, et le code garde la decision de consulter ou non.

    Nulle des qu'elle est absente, inconnue ou illisible : le tour se joue
    sans rappel, comme avant ce corpus.
  */
  situation: SituationSchema.nullable().catch(null).default(null),
});

export type ModerationVerdict = z.infer<typeof ModerationVerdictSchema>;

