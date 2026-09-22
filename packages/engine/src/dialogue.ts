import { entityKey, type Entity, type Situation } from '@odyssai/schemas';

/*
  Les situations ou le joueur s'adresse a quelqu'un. Ailleurs, un personnage
  n'a pas a repondre : on n'interroge pas une porte, et on ne negocie pas en
  frappant.
*/
export const SPEECH_SITUATIONS: readonly Situation[] = [
  'interrogation',
  'echange',
  'intimite',
  'tromperie',
  'contrainte',
];

export interface InterlocutorInput {
  message: string;
  situation: Situation | null;
  entities: Entity[];
  // Les derniers tours, du plus ancien au plus recent.
  recent: { role: 'user' | 'assistant'; content: string }[];
}

// Un nom apparait dans un texte : mots entiers, diacritiques et casse repliees.
function names(text: string, npc: Entity): boolean {
  const haystack = ` ${entityKey(text)} `;
  const key = entityKey(npc.name);
  if (key.length === 0) return false;
  if (haystack.includes(` ${key} `)) return true;

  // « Mireille » suffit pour « Mireille la Cuillere » : le premier mot d'un
  // nom compose, s'il est assez long pour ne pas etre un article.
  const first = key.split(' ')[0]!;
  return first.length >= 3 && key.includes(' ') && haystack.includes(` ${first} `);
}

/*
  A qui le joueur parle, ou null.

  C'est le code qui decide, jamais le modele : le personnage nomme dans le
  message, sinon le dernier nomme par le meneur au tour precedent, celui qui
  est en scene. Seulement quand la situation est un acte de parole.
*/
export function interlocutorOf(input: InterlocutorInput): Entity | null {
  if (!input.situation || !SPEECH_SITUATIONS.includes(input.situation)) return null;

  const npcs = input.entities.filter((entity) => entity.kind === 'npc');
  if (npcs.length === 0) return null;

  const addressed = npcs.find((npc) => names(input.message, npc));
  if (addressed) return addressed;

  const last = [...input.recent].reverse().find((turn) => turn.role === 'assistant');
  if (!last) return null;

  // Le dernier nomme dans le recit, pas le premier : c'est lui qui a la parole.
  let found: Entity | null = null;
  let at = -1;
  for (const npc of npcs) {
    const position = entityKey(last.content).lastIndexOf(entityKey(npc.name));
    if (position > at) {
      at = position;
      found = npc;
    }
  }
  return found;
}
