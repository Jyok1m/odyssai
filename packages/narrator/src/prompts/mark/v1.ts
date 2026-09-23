import type { MarkKind, UiLocale, WorldCharter } from '@odyssai/schemas';
import type { PromptMessage } from '../guide/v1.js';

export interface MarkContext {
  charter: WorldCharter;
  world: string;
  kind: MarkKind;
  // Ce que le meneur vient de raconter, et d'ou la marque vient.
  scene: string;
  // Celles qu'il porte deja, pour ne pas en ecrire deux fois la meme.
  existing: string[];
}

/*
  Une marque rapportee, en une ligne.

  Le genre est decide par le code, jamais par le modele : une marque qu'il
  accorderait finirait par s'accorder a celui qui la demande. Il n'ecrit que
  le texte, et il l'ecrit court : c'est une trace, pas un recit.
*/
const INSTRUCTIONS: Record<UiLocale, string> = {
  fr: `Tu écris ce qu'un personnage garde de ce qui vient de lui arriver.

Réponds uniquement par un objet JSON, sans texte autour, sans balise de code :
{"text":"..."}

- Une seule ligne, quinze mots au plus. Pas de phrase complète obligatoire : un fragment se retient mieux.
- Ce n'est pas un objet. On ne revient pas d'un monde avec une épée, on en revient changé : une trace sur le corps, une peur neuve, une chose dont on est désormais sûr.
- Concret et montrable. « Une ligne fine en travers de la paume gauche », « les couloirs qui ne mènent nulle part », « certaines cartes doivent rester fausses ». Jamais « il a mûri », jamais « une nouvelle force intérieure ».
- Écris du point de vue du personnage, sans le nommer et sans dire « je » ni « tu ».
- Tu peux nommer un lieu ou quelqu'un de ce monde : c'est ce qui rend la marque reconnaissable ailleurs.
- N'écris pas une marque qui répète une de celles qu'il porte déjà.
- Le genre demandé commande :
  - « cicatrice » : ce que le corps garde. Le personnage vient de tomber.
  - « peur » : ce qu'il évitera désormais sans y penser.
  - « conviction » : ce qu'il tient pour vrai depuis, et qu'il ne tenait pas avant.
- Relis-toi : accords, conjugaisons, accents. Cette ligne le suivra dans tous ses mondes.
- N'emprunte rien à une œuvre existante.`,

  en: `You write what a character keeps of what has just happened to them.

Answer with a JSON object only, no surrounding text, no code fence:
{"text":"..."}

- One line, fifteen words at most. It need not be a full sentence: a fragment is remembered better.
- It is not an object. You do not come back from a world with a sword, you come back changed: a mark on the body, a new fear, something you are now certain of.
- Concrete and showable. "A thin line across the left palm", "the corridors that lead nowhere", "some maps must stay wrong". Never "he has matured", never "a new inner strength".
- Write from the character's point of view, without naming them and without "I" or "you".
- You may name a place or someone from this world: that is what makes the mark recognisable elsewhere.
- Do not write a mark that repeats one they already carry.
- The requested kind commands:
  - "cicatrice": what the body keeps. The character has just fallen.
  - "peur": what they will now avoid without thinking.
  - "conviction": what they hold true since, and did not hold before.
- Read it back for agreement, tense and spelling. This line follows them into every one of their worlds.
- Borrow nothing from an existing work.`,
};

export const MARK_PROMPT = {
  id: 'mark/v1',

  build(locale: UiLocale, context: MarkContext): PromptMessage[] {
    const world = [
      `<monde>\n${context.world}\n</monde>`,
      `<ton>\n${context.charter.tone}\n</ton>`,
      `<genre>\n${context.kind}\n</genre>`,
      context.existing.length > 0
        ? `<deja_portees>\n${context.existing.join('\n')}\n</deja_portees>`
        : '',
      `<scene>\n${context.scene}\n</scene>`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return [{ role: 'system', content: `${INSTRUCTIONS[locale]}\n\n${world}` }];
  },
};
