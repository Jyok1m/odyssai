import type { LlmStreamEvent } from '@odyssai/llm';

/**
 * Le modele repond exactement ceci quand la question sort du perimetre. Une
 * sentinelle plutot qu'un texte libre : le texte servi au visiteur est ecrit
 * cote serveur, donc ni traduit de travers ni inventif.
 */
export const OFF_TOPIC_SENTINEL = '[[HORS_SUJET]]';

export interface GuideUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export type OffTopicSplit =
  | { kind: 'off_topic'; usage: GuideUsage | undefined }
  | {
      kind: 'stream';
      chunks: AsyncIterable<string>;
      /** Definitif une fois `chunks` epuise. */
      usage: () => GuideUsage | undefined;
    };

/**
 * Bufferise le debut du flux pour decider s'il s'agit d'un refus.
 *
 * Tant que le buffer reste un prefixe de la sentinelle, on accumule sans rien
 * emettre. Des qu'elle est complete, on coupe l'appel amont : inutile de payer
 * une generation dont rien ne sera servi. Des que le buffer diverge, on rend le
 * buffer puis la suite, sans alteration.
 *
 * La sentinelle arrive souvent coupee entre plusieurs chunks, d'ou la
 * comparaison par prefixe plutot qu'une egalite sur le premier chunk.
 */
export async function splitOffTopic(
  source: AsyncIterable<LlmStreamEvent>,
  abort: AbortController,
): Promise<OffTopicSplit> {
  const iterator = source[Symbol.asyncIterator]();
  let buffer = '';
  let usage: GuideUsage | undefined;

  const seen = (event: LlmStreamEvent): boolean => {
    if (event.type !== 'usage') return false;
    const { type: _ignored, ...rest } = event;
    usage = rest;
    return true;
  };

  for (;;) {
    const next = await iterator.next();

    if (next.done) {
      // Flux epuise sans divergence : soit vide, soit prefixe incomplet. On
      // rend ce qu'on a plutot que de perdre la reponse.
      return { kind: 'stream', chunks: replay(buffer), usage: () => usage };
    }

    if (seen(next.value)) continue;
    if (next.value.type !== 'text') continue;

    buffer += next.value.text;
    const candidate = buffer.trimStart();

    if (candidate.startsWith(OFF_TOPIC_SENTINEL)) {
      abort.abort();
      return { kind: 'off_topic', usage };
    }

    if (!OFF_TOPIC_SENTINEL.startsWith(candidate)) {
      return {
        kind: 'stream',
        chunks: replay(buffer, iterator, seen),
        usage: () => usage,
      };
    }
  }
}

async function* replay(
  buffered: string,
  iterator?: AsyncIterator<LlmStreamEvent>,
  seen?: (event: LlmStreamEvent) => boolean,
): AsyncIterable<string> {
  if (buffered) yield buffered;
  if (!iterator) return;

  for (;;) {
    const next = await iterator.next();
    if (next.done) return;
    if (seen?.(next.value)) continue;
    if (next.value.type === 'text') yield next.value.text;
  }
}
