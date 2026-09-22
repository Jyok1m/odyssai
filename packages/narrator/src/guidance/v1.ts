import {
  GUIDANCE_PER_TURN_MAX,
  type Situation,
  type UiLocale,
} from '@odyssai/schemas';

/*
  Ce qu'un meneur sait faire dans une situation precise, et qui ne vaut que la.
  Une consigne vraie a tous les tours appartient au prompt du meneur : rappelee
  a chaque appel, elle couterait des jetons sans rien apprendre et diluerait
  celles qui comptent.
*/
export interface GuidanceCard {
  // Stable : il se retrouve dans une trace et dans une evaluation.
  id: string;
  fr: string;
  en: string;
}

const COMBAT_SANS_COMPTE: GuidanceCard = {
  id: 'combat-sans-compte',
  fr: `Un affrontement ne se compte pas en points ni en tours de table. Un échange décide d'une position : qui recule, qui tient, qui a lâché son arme, ce qui bloque la sortie. Dis où en sont les deux à la fin, et ce que l'autre s'apprête à faire.`,
  en: `A fight is not counted in points or in rounds around a table. One exchange settles a position: who backs off, who holds, who has dropped their weapon, what blocks the way out. Say where both stand at the end, and what the other is about to do.`,
};

const BLESSURE_QUI_DURE: GuidanceCard = {
  id: 'blessure-qui-dure',
  fr: `Une blessure ne se referme pas parce que la scène a changé. Elle gêne un geste précis au tour suivant, et à celui d'après : le bras qui porte mal, le souffle court, le sang sur les doigts que les autres voient. Elle compte comme un fait, pas comme un décor.`,
  en: `A wound does not close because the scene has moved on. It hampers one precise gesture next turn, and the turn after: the arm that carries badly, the short breath, the blood on the fingers that others can see. It counts as a fact, not as scenery.`,
};

const MORT_ANNONCEE: GuidanceCard = {
  id: 'mort-annoncee',
  fr: `Le personnage du joueur ne meurt pas d'un coup qu'il n'a pas vu venir. Le danger se montre d'abord (l'arme sortie, le sol qui cède, la fièvre qui monte) et il a un tour pour s'en écarter. S'il ne s'en écarte pas, la suite lui appartient.`,
  en: `The player's character does not die from a blow they never saw coming. The danger shows itself first (the drawn blade, the ground giving way, the fever rising) and they have one turn to get clear. If they do not, what follows is theirs.`,
};

const COUP_PORTE_A_QUELQUUN: GuidanceCard = {
  id: 'coup-porte-a-quelquun',
  fr: `Celui que le joueur frappe a un nom, une occupation et quelqu'un qui le cherchera. Dis ce que la violence coûte sur le moment, et qui la remarque : un témoin, un silence dans la salle, une porte qui se ferme ailleurs. Le monde s'en souvient.`,
  en: `Whoever the player strikes has a name, an occupation, and someone who will come looking for them. Say what the violence costs in the moment, and who notices: a witness, a hush in the room, a door closing elsewhere. The world remembers it.`,
};

const REFUS_MOTIVE: GuidanceCard = {
  id: 'refus-motive',
  fr: `Un personnage à qui on ordonne, ou qu'on presse, ne cède pas parce que la phrase était bien tournée. Il pèse ce qu'il a à perdre : sa place, sa peau, quelqu'un qu'il protège. Il cède, il tient bon, il promet et n'en fera rien, ou il va chercher plus fort que lui.`,
  en: `A character who is ordered about, or leaned on, does not give in because the line was well turned. They weigh what they stand to lose: their position, their skin, someone they protect. They give in, they hold out, they promise and will do nothing, or they go and fetch someone stronger.`,
};

const PRIX_QUI_NEST_PAS_LARGENT: GuidanceCard = {
  id: 'prix-qui-nest-pas-largent',
  fr: `Ce qu'on demande a un prix, et le prix n'est pas toujours une somme. Un service à rendre, un nom à donner, un silence à tenir, une visite dans trois jours. Celui qui vend veut quelque chose du joueur, et il le dit.`,
  en: `What is asked for has a price, and the price is not always a sum. A favour owed, a name given up, a silence kept, a visit in three days. The one who sells wants something from the player, and says so.`,
};

const SAVOIR_PARTIEL: GuidanceCard = {
  id: 'savoir-partiel',
  fr: `Celui qui sait ne dit pas tout, et ne sait pas toujours juste. Il donne ce qui l'arrange, garde ce qui l'expose, et se trompe parfois de bonne foi. Ce qu'il lâche doit ouvrir une question que le joueur n'avait pas.`,
  en: `The one who knows does not tell all, and is not always right. They give what suits them, keep back what exposes them, and are sometimes wrong in good faith. What they let out should open a question the player did not have.`,
};

const MENSONGE_DU_JOUEUR: GuidanceCard = {
  id: 'mensonge-du-joueur',
  fr: `Quand le joueur ment, l'autre le croit ou non selon ce qu'il sait déjà, pas selon l'habileté de la phrase. S'il doute, il ne le dit pas : il vérifie, il pose une question dont il connaît la réponse, ou il fait semblant d'y croire.`,
  en: `When the player lies, the other believes it or not according to what they already know, not to how deft the line was. If they doubt it, they do not say so: they check, they ask a question they already know the answer to, or they play along.`,
};

const TRACE_LAISSEE: GuidanceCard = {
  id: 'trace-laissee',
  fr: `Se cacher, suivre ou prendre sans être vu laisse toujours quelque chose : une porte restée ouverte, un bruit, un manque qu'on remarquera plus tard. Le joueur ne sait pas ce qu'il a laissé derrière lui, et tu ne le lui dis pas.`,
  en: `Hiding, shadowing or taking unseen always leaves something: a door left open, a sound, a gap that will be noticed later. The player does not know what they left behind, and you do not tell them.`,
};

const TROUVAILLE_UTILE: GuidanceCard = {
  id: 'trouvaille-utile',
  fr: `Ce qu'on trouve change la situation, sinon on ne le trouve pas. Un accès, une preuve, un nom, la marque de quelqu'un passé avant. Rien de décoratif : un objet qui ne sert à rien encombre la scène et fait croire qu'il compte.`,
  en: `What is found changes the situation, otherwise it is not found. A way in, a proof, a name, the mark of someone who came before. Nothing decorative: an object that serves no purpose clutters the scene and makes the player think it matters.`,
};

const TRAJET_HABITE: GuidanceCard = {
  id: 'trajet-habite',
  fr: `Un déplacement n'est pas un fondu au noir. Soit une chose se voit en chemin et tu la montres en une phrase, soit l'arrivée est immédiate et la scène commence sur place. Jamais un tour passé à marcher.`,
  en: `A journey is not a fade to black. Either one thing is seen along the way and you show it in a sentence, or the arrival is immediate and the scene starts there. Never a turn spent walking.`,
};

const LIEU_SANS_PERSONNE: GuidanceCard = {
  id: 'lieu-sans-personne',
  fr: `Si personne n'est présent dans la scène, alors c'est le lieu qui agit : l'eau qui monte, la lumière qui tombe, une bête, une machine qui tourne encore, une trace fraîche. Quelqu'un est là : laisse le lieu tranquille, c'est cette personne qui agit.`,
  en: `If no one is present in the scene, then the place acts: water rising, light failing, an animal, a machine still turning, a fresh track. Someone is there: leave the place alone, that person is the one who acts.`,
};

const OUVRAGE_IMPARFAIT: GuidanceCard = {
  id: 'ouvrage-imparfait',
  fr: `Ce que le personnage fabrique, répare ou soigne demande du temps, un outil qu'il n'a pas, ou ne tient qu'à moitié. Dis ce que ça donne concrètement : ce qui marche, ce qui reste fragile, et ce qu'il faudrait pour finir.`,
  en: `What the character makes, mends or treats takes time, a tool they do not have, or only half holds. Say what it actually comes to: what works, what stays fragile, and what it would take to finish.`,
};

const TENTATIVE_SANS_TALENT: GuidanceCard = {
  id: 'tentative-sans-talent',
  fr: `Le joueur tente ce que sa fiche ne couvre pas. Il essaie quand même, et ça se voit qu'il ne sait pas faire : le geste est lent, bruyant, approximatif. L'échec sert à quelque chose : quelqu'un le remarque, ou il comprend ce qui lui manque.`,
  en: `The player attempts what their sheet does not cover. They try anyway, and it shows that they do not know how: the movement is slow, loud, rough. The failure is good for something: someone notices, or they learn what they are missing.`,
};

const MONDE_QUI_AVANCE: GuidanceCard = {
  id: 'monde-qui-avance',
  fr: `Pendant que le joueur attend, le monde travaille. À la reprise, quelque chose n'est plus à sa place : quelqu'un est parti, un délai a couru, une porte est gardée maintenant. Ce qui a changé est ce que vaut son tour.`,
  en: `While the player waits, the world works. When they pick things up again, something is out of place: someone has left, a deadline has run, a door is guarded now. What changed is what their turn was worth.`,
};

const REPONSE_EN_IMAGE: GuidanceCard = {
  id: 'reponse-en-image',
  fr: `Une question sur le monde se répond par ce qu'on en voit, pas par une notice. Montre qui le sait, comment on le dit là-bas, ce qui le prouve dans la rue. Une phrase de plus qu'il n'en attendait, jamais un exposé.`,
  en: `A question about the world is answered by what can be seen of it, not by an encyclopaedia entry. Show who knows it, how it is said there, what proves it in the street. One sentence more than they expected, never a lecture.`,
};

const SORTIE_DE_FICTION: GuidanceCard = {
  id: 'sortie-de-fiction',
  fr: `Une question sur le jeu lui-même n'a pas de réponse dans le monde. Réponds en une phrase, hors de la fiction, sans personnage et sans décor, puis reprends la scène exactement où elle était. Ne fais jamais dire à un personnage ce qui relève de l'interface.`,
  en: `A question about the game itself has no answer inside the world. Answer in one sentence, outside the fiction, with no character and no scenery, then pick the scene up exactly where it was. Never have a character say what belongs to the interface.`,
};

const REFUS_PAR_LE_MONDE: GuidanceCard = {
  id: 'refus-par-le-monde',
  fr: `Ce que le joueur réclame et que le monde ne contient pas ne se refuse pas par « tu ne peux pas ». Le monde répond ce qu'il a : ce qui existe à la place, qui prétend pouvoir le fournir, et ce que ça coûterait d'aller voir.`,
  en: `What the player demands and the world does not hold is not refused with "you cannot". The world answers with what it has: what exists instead, who claims to be able to supply it, and what going to find out would cost.`,
};

const VOLONTE_DE_LAUTRE: GuidanceCard = {
  id: 'volonte-de-lautre',
  fr: `Quelqu'un dont le joueur cherche l'attention a ses propres raisons, et l'insistance n'en est pas une. Il peut ne pas vouloir, et le dire, ou vouloir autre chose que ce qu'on lui propose. Si la scène devient intime, ferme la porte et reprends plus tard.`,
  en: `Someone whose attention the player seeks has their own reasons, and insistence is not one of them. They may not want to, and say so, or want something other than what is offered. If the scene turns intimate, close the door and pick it up later.`,
};

const CE_QUIL_DIT_DE_LUI: GuidanceCard = {
  id: 'ce-quil-dit-de-lui',
  fr: `Quand le joueur dit de son personnage une chose que sa fiche ne portait pas, prends-la pour vraie et retiens-la : son passé lui appartient. Sers-t'en tout de suite, dans ce que quelqu'un remarque ou reconnaît.`,
  en: `When the player says something about their character that the sheet did not hold, take it as true and keep it: their past is theirs. Use it at once, in what someone notices or recognises.`,
};

/*
  Un `Record` complet plutot qu'un champ `situations` sur chaque fiche : le
  compilateur refuse alors d'oublier une situation.

  L'ordre decide de ce qui existe : la borne ne sert que les premieres, donc
  une fiche qui n'apparait qu'au dela, dans toutes les listes ou elle figure,
  n'est jamais rendue a personne. `guidance.spec.ts` le verifie, rien dans le
  type ne l'empeche.
*/
const BY_SITUATION: Record<Situation, readonly GuidanceCard[]> = {
  violence: [
    COMBAT_SANS_COMPTE,
    BLESSURE_QUI_DURE,
    COUP_PORTE_A_QUELQUUN,
    MORT_ANNONCEE,
    TENTATIVE_SANS_TALENT,
  ],
  contrainte: [REFUS_MOTIVE, COUP_PORTE_A_QUELQUUN, VOLONTE_DE_LAUTRE],
  tromperie: [MENSONGE_DU_JOUEUR, TRACE_LAISSEE, TENTATIVE_SANS_TALENT],
  echange: [PRIX_QUI_NEST_PAS_LARGENT, REFUS_MOTIVE],
  interrogation: [SAVOIR_PARTIEL, REFUS_MOTIVE],
  lore: [REPONSE_EN_IMAGE, SAVOIR_PARTIEL, CE_QUIL_DIT_DE_LUI],
  exploration: [
    TROUVAILLE_UTILE,
    LIEU_SANS_PERSONNE,
    TRAJET_HABITE,
    TRACE_LAISSEE,
  ],
  entreprise: [OUVRAGE_IMPARFAIT, TENTATIVE_SANS_TALENT],
  intimite: [VOLONTE_DE_LAUTRE, CE_QUIL_DIT_DE_LUI],
  demesure: [REFUS_PAR_LE_MONDE, MORT_ANNONCEE],
  attente: [MONDE_QUI_AVANCE, TRAJET_HABITE],
  meta: [SORTIE_DE_FICTION],
};

export const GUIDANCE = {
  id: 'guidance/v1',

  /*
    Le texte pour le prompt et l'identifiant pour la base, d'une seule source :
    les demander separement les ferait diverger le jour ou l'ordre change.

    Deterministe : une rotation ferait varier la consigne sous un meneur qui
    n'a pas change de scene. Situation nulle (verdict illisible, etiquette
    inconnue, ouverture) : le tour se joue sans rappel.
  */
  for(
    situation: Situation | null,
    locale: UiLocale,
  ): { id: string; text: string }[] {
    if (!situation) return [];

    return (BY_SITUATION[situation] ?? [])
      .slice(0, GUIDANCE_PER_TURN_MAX)
      .map((card) => ({ id: card.id, text: card[locale] }));
  },

  // Une seule fois chacune : une meme fiche sert plusieurs situations.
  get cards(): readonly GuidanceCard[] {
    return [
      ...new Map(
        Object.values(BY_SITUATION)
          .flat()
          .map((card) => [card.id, card]),
      ).values(),
    ];
  },
} as const;
