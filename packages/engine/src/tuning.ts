/**
 * Les reglages du jeu, au meme endroit.
 *
 * Tout ce qui se regle sans changer de code vit ici : ce qu'une action coute,
 * combien de fois on rejoue, ce qu'un joueur peut ecrire, ce dont le meneur se
 * souvient. Avant ce fichier il fallait connaitre cinq fichiers dans trois
 * paquets pour savoir ou tourner un bouton.
 *
 * **Une valeur n'a qu'une definition.** Ce fichier est un index, pas une copie :
 * quand la valeur appartient a un schema, il la reexporte depuis
 * `@odyssai/schemas`, ou le schema Zod qui la fait respecter la lit deja. La
 * dupliquer ici ferait deux verites, et la fausse serait celle qu'on aurait
 * pris l'habitude de lire.
 *
 * Ce qui n'est pas ici, et pourquoi :
 *
 * - Les paliers d'abonnement, dotations et prix compris, vivent dans la table
 *   `plans` et s'editent au tableau de bord. Changer une dotation ne doit pas
 *   demander un deploiement.
 * - Le choix des modeles, leurs temperatures et leurs plafonds de sortie
 *   restent dans l'environnement : ils dependent de la copie du site, et une
 *   cle d'API n'entre pas dans un depot.
 * - La liste lexicale de moderation est dans `moderation.ts`, avec le detail
 *   cas par cas de ce qui a ete retire et pourquoi. Ce n'est pas un curseur,
 *   c'est une decision par mot.
 */
import {
  ATTRIBUTES_MAX,
  CANON_FACTS_PER_TURN_MAX,
  CHARACTER_MESSAGE_MAX_CHARS,
  CHARACTER_NAME_MAX,
  CHARACTER_TURNS_MAX,
  CHARACTER_TURNS_MIN,
  GENERATION_ATTEMPTS_PER_NODE,
  GENERATION_REWRITES_MAX,
  GUIDE_QUESTION_MAX_CHARS,
  OWN_DESCRIPTION_MAX,
  OWN_DESCRIPTION_MIN,
  TRAITS_MAX,
  TURN_MESSAGE_MAX_CHARS,
  WORKS_MAX,
  WORK_TITLE_MAX,
} from '@odyssai/schemas';

import {
  CREDIT_COSTS,
  FOUNDER_BONUS,
  FREE_PLAN_SLUG,
  PLAN_LIMITS,
} from './credits.js';
import { DIE_FACES } from './die.js';

/**
 * Les tours rendus au meneur mot pour mot. Au dela, c'est le rappel par
 * similarite qui prend le relais.
 *
 * C'est le curseur qui pese le plus sur le cout d'un tour : l'entree passe de
 * 3 800 a 6 900 jetons entre le premier tour et le douzieme, et s'y stabilise.
 * Le baisser fait economiser des jetons et perdre de la continuite.
 */
export const RECENT_TURNS = 12;

/** Ce qu'une recherche par similarite ramene au plus. */
export const RECALLED_MAX = 6;

export const TUNING = {
  /**
   * Ce qu'une action coute au joueur. Le rapport entre un credit et son cout
   * reel se regle ici, sans toucher a Stripe.
   *
   * Mesure : un tour coute 0,0012 $ et un monde 0,0040 $, soit trois tours. Les
   * 25 credits d'un monde sont une assurance contre les rejeux du graphe, pas
   * le reflet d'un cout. C'est un choix commercial, et il s'assume comme tel.
   */
  credits: CREDIT_COSTS,

  /** Bornes d'un palier, appliquees a la creation comme a la modification. */
  plans: { ...PLAN_LIMITS, freeSlug: FREE_PLAN_SLUG },

  /** Ce que recoivent les premiers arrives, en plus de leur palier. */
  founder: FOUNDER_BONUS,

  /** Le de du meneur. Le joueur ne voit jamais le chiffre, seulement la bande. */
  die: { faces: DIE_FACES },

  /** L'inspiration citee, puis la generation du monde. */
  world: {
    worksMax: WORKS_MAX,
    workTitleMax: WORK_TITLE_MAX,
    ownDescriptionMin: OWN_DESCRIPTION_MIN,
    ownDescriptionMax: OWN_DESCRIPTION_MAX,
    /** Deux essais par noeud : un modele rate rarement deux fois pareil. */
    attemptsPerNode: GENERATION_ATTEMPTS_PER_NODE,
    /**
     * Reprises du lore apres un nom emprunte detecte par le controle final.
     * Chaque reprise coute un appel et ne garantit pas de converger.
     */
    rewritesMax: GENERATION_REWRITES_MAX,
  },

  /** La conversation de creation de personnage, et la fiche qui en sort. */
  character: {
    nameMax: CHARACTER_NAME_MAX,
    traitsMax: TRAITS_MAX,
    attributesMax: ATTRIBUTES_MAX,
    messageMaxChars: CHARACTER_MESSAGE_MAX_CHARS,
    /** En deca, la fiche n'est pas extractible : il n'y a rien a extraire. */
    turnsMin: CHARACTER_TURNS_MIN,
    /** Le cout est borne par le nombre de tours, le joueur etant authentifie. */
    turnsMax: CHARACTER_TURNS_MAX,
  },

  /** Le tour de jeu et la memoire du meneur. */
  turn: {
    messageMaxChars: TURN_MESSAGE_MAX_CHARS,
    canonFactsMax: CANON_FACTS_PER_TURN_MAX,
    recentTurns: RECENT_TURNS,
    recalledMax: RECALLED_MAX,
  },

  /** L'agent de questions-reponses du site vitrine. */
  guide: { questionMaxChars: GUIDE_QUESTION_MAX_CHARS },
} as const;

export type Tuning = typeof TUNING;
