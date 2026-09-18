import type { LlmStreamEvent } from '@odyssai/llm';

/**
 * Ce qui separe le recit rendu au joueur du bloc rendu a la base.
 *
 * Volontairement improbable en prose francaise : un meneur n'ecrit pas deux
 * crochets ouvrants suivis d'un mot en majuscules.
 */
export const CANON_MARKER = '[[CANON]]';

export interface TailUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface TailSplit {
  /** Le recit, sans jamais un fragment du marqueur. */
  chunks: AsyncIterable<string>;
  /** Ce qui suit le marqueur. Definitif une fois `chunks` epuise. */
  tail: () => string;
  /**
   * Vrai si le marqueur est passe. Distinct d'une queue non vide : un marqueur
   * pose en dernier ne laisse rien derriere lui, et c'est le cas de celui qui
   * ne sert qu'a signaler, sans rien porter.
   */
  seen: () => boolean;
  /** Definitif une fois `chunks` epuise. */
  usage: () => TailUsage;
}

/**
 * Longueur du suffixe du tampon qu'il faut retenir parce qu'il pourrait etre
 * le debut du marqueur.
 *
 * On retient le plus long suffixe qui soit un prefixe du marqueur, et non une
 * fenetre fixe : « le recit s'ouvre [[ » relache ses crochets des que la suite
 * diverge, au lieu de faire attendre le joueur pour rien.
 */
function heldBack(buffer: string, marker: string): number {
  const max = Math.min(buffer.length, marker.length - 1);

  for (let size = max; size > 0; size -= 1) {
    if (marker.startsWith(buffer.slice(buffer.length - size))) return size;
  }

  return 0;
}

/**
 * Coupe un flux en deux : la prose devant, le bloc structure derriere.
 *
 * L'inverse de `splitOffTopic`, qui decide avant le premier octet parce que sa
 * sentinelle est en tete. Ici le marqueur est en queue et la prose doit partir
 * au fil de l'eau : on ne peut donc pas attendre la fin, il faut retenir en
 * permanence ce qui pourrait etre un debut de marqueur.
 *
 * Le flux n'est jamais avorte, meme quand le joueur est parti : le bloc de
 * queue doit arriver pour que le canon s'ecrive. C'est a l'appelant d'arreter
 * la diffusion sans arreter la generation.
 */
export function splitTail(
  source: AsyncIterable<LlmStreamEvent>,
  marker: string = CANON_MARKER,
): TailSplit {
  const usage: TailUsage = {};
  let tail = '';
  let marked = false;

  async function* read(): AsyncIterable<string> {
    let buffer = '';
    let past = false;

    for await (const event of source) {
      if (event.type === 'usage') {
        usage.model = event.model;
        usage.inputTokens = event.inputTokens;
        usage.outputTokens = event.outputTokens;
        usage.reasoningTokens = event.reasoningTokens;
        usage.costUsd = event.costUsd;
        continue;
      }

      if (event.type !== 'text') continue;

      if (past) {
        tail += event.text;
        continue;
      }

      buffer += event.text;
      const at = buffer.indexOf(marker);

      if (at !== -1) {
        const prose = buffer.slice(0, at);
        if (prose) yield prose;
        tail = buffer.slice(at + marker.length);
        past = true;
        marked = true;
        buffer = '';
        continue;
      }

      const safe = buffer.length - heldBack(buffer, marker);
      if (safe > 0) {
        yield buffer.slice(0, safe);
        buffer = buffer.slice(safe);
      }
    }

    // Flux epuise sans marqueur : ce qui restait retenu n'en etait pas un
    // debut, et le joueur y a droit.
    if (!past && buffer) yield buffer;
  }

  return {
    chunks: read(),
    tail: () => tail,
    seen: () => marked,
    usage: () => usage,
  };
}
