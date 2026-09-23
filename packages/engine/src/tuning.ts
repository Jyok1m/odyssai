/*
  Index des reglages : ce qui se tourne sans changer de logique. Une valeur
  n'a qu'une definition, donc celle qui appartient a un schema se reexporte
  depuis `@odyssai/schemas` au lieu d'etre recopiee ici.

  Hors d'ici : les paliers, qui vivent en base et s'editent au tableau de
  bord ; le choix des modeles, qui reste dans l'environnement ; la liste
  lexicale de moderation, qui est une decision par mot, pas un curseur.
*/
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTES,
  CANON_FACTS_PER_TURN_MAX,
  CHARACTER_MESSAGE_MAX_CHARS,
  CHARACTER_NAME_MAX,
  CHARACTER_TURNS_MAX,
  CHARACTER_TURNS_MIN,
  GENERATION_ATTEMPTS_PER_NODE,
  GENERATION_REWRITES_MAX,
  GUIDANCE_PER_TURN_MAX,
  GUIDE_QUESTION_MAX_CHARS,
  OWN_DESCRIPTION_MAX,
  OWN_DESCRIPTION_MIN,
  TALENTS_MAX,
  TRAITS_MAX,
  TURN_MESSAGE_MAX_CHARS,
  WORKS_MAX,
  WORK_TITLE_MAX,
} from '@odyssai/schemas';

import {
  ALPHA_SEATS,
  CREDIT_COSTS,
  FOUNDER_BONUS,
  FREE_PLAN_SLUG,
  PLAN_LIMITS,
} from './credits.js';
import { DIE_FACES } from './die.js';
import { HP_BASE, HP_PER_CORPS, REST_STEP } from './health.js';
import { PROGRESS_STEPS } from './progress.js';

/*
  Les tours rendus au meneur mot pour mot. Au dela, c'est le rappel par
  similarite qui prend le relais.

  C'est le curseur qui pese le plus sur le cout d'un tour : l'entree passe de
  3 800 a 6 900 jetons entre le premier tour et le douzieme, et s'y stabilise.
  Le baisser fait economiser des jetons et perdre de la continuite.
*/
export const RECENT_TURNS = 12;

// Ce qu'une recherche par similarite ramene au plus.
export const RECALLED_MAX = 6;

export const TUNING = {
  /*
    Ce qu'une action coute au joueur. Le rapport entre un credit et son cout
    reel se regle ici, sans toucher a Stripe.

    Mesure : un tour coute 0,0012 $ et un monde 0,0040 $, soit trois tours. Les
    25 credits d'un monde sont une assurance contre les rejeux du graphe, pas
    le reflet d'un cout. C'est un choix commercial, et il s'assume comme tel.
  */
  credits: CREDIT_COSTS,

  // Bornes d'un palier, appliquees a la creation comme a la modification.
  plans: { ...PLAN_LIMITS, freeSlug: FREE_PLAN_SLUG },

  // Ce que recoivent les premiers arrives, en plus de leur palier.
  founder: FOUNDER_BONUS,

  // Places de l'alpha fermee. Au dela, aucun joueur n'est provisionne.
  alpha: { seats: ALPHA_SEATS },

  // Le de du meneur. Le joueur ne voit jamais le chiffre, seulement la bande.
  die: { faces: DIE_FACES },

  /*
    La sante, tenue par le code. La reserve derive de `corps`, les degats de
    la bande du de, et le repos se compte en tours calmes : il n'y a pas
    d'horloge dans ce jeu.
  */
  health: { base: HP_BASE, perCorps: HP_PER_CORPS, restStep: REST_STEP },

  // L'inspiration citee, puis la generation du monde.
  world: {
    worksMax: WORKS_MAX,
    workTitleMax: WORK_TITLE_MAX,
    ownDescriptionMin: OWN_DESCRIPTION_MIN,
    ownDescriptionMax: OWN_DESCRIPTION_MAX,
    // Deux essais par noeud : un modele rate rarement deux fois pareil.
    attemptsPerNode: GENERATION_ATTEMPTS_PER_NODE,
    /*
      Reprises du lore apres un nom emprunte detecte par le controle final.
      Chaque reprise coute un appel et ne garantit pas de converger.
    */
    rewritesMax: GENERATION_REWRITES_MAX,
  },

  // La conversation de creation de personnage, et la fiche qui en sort.
  character: {
    nameMax: CHARACTER_NAME_MAX,
    traitsMax: TRAITS_MAX,
    attributes: ATTRIBUTES,
    attributeMin: ATTRIBUTE_MIN,
    attributeMax: ATTRIBUTE_MAX,
    talentsMax: TALENTS_MAX,
    // Ce qu'il faut de jets pour passer d'un score au suivant.
    progressSteps: PROGRESS_STEPS,
    messageMaxChars: CHARACTER_MESSAGE_MAX_CHARS,
    // En deca, la fiche n'est pas extractible : il n'y a rien a extraire.
    turnsMin: CHARACTER_TURNS_MIN,
    // Le cout est borne par le nombre de tours, le joueur etant authentifie.
    turnsMax: CHARACTER_TURNS_MAX,
  },

  // Le tour de jeu et la memoire du meneur.
  turn: {
    messageMaxChars: TURN_MESSAGE_MAX_CHARS,
    canonFactsMax: CANON_FACTS_PER_TURN_MAX,
    recentTurns: RECENT_TURNS,
    recalledMax: RECALLED_MAX,
    guidanceMax: GUIDANCE_PER_TURN_MAX,
  },

  // L'agent de questions-reponses du site vitrine.
  guide: { questionMaxChars: GUIDE_QUESTION_MAX_CHARS },
} as const;

export type Tuning = typeof TUNING;
