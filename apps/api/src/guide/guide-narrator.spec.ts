import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmStreamEvent } from '@odyssai/llm';
import {
  findFaqAnswer,
  loadFaq,
  normalizeQuestion,
  questionHash,
  splitOffTopic,
} from '@odyssai/narrator';

const FIXTURES = join(import.meta.dirname, '..', '..', 'test', 'fixtures');

async function* stream(
  texts: string[],
  usage?: boolean,
): AsyncIterable<LlmStreamEvent> {
  for (const text of texts) yield { type: 'text', text };
  if (usage) {
    yield {
      type: 'usage',
      model: 'modele/de-test',
      inputTokens: 2_000,
      outputTokens: 40,
      costUsd: 0.0009,
    };
  }
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of chunks) out += chunk;
  return out;
}

describe('normalizeQuestion', () => {
  it('efface casse, accents, ponctuation et espaces', () => {
    expect(normalizeQuestion('  Comment ÇA marche ?!  ')).toBe('comment ca marche');
  });

  it('rapproche deux formulations equivalentes', () => {
    expect(questionHash('fr', 'Comment ça marche ?')).toBe(
      questionHash('fr', 'comment ca marche'),
    );
  });

  it('separe les locales', () => {
    expect(questionHash('fr', 'test')).not.toBe(questionHash('en', 'test'));
  });
});

describe('loadFaq', () => {
  it('n indexe que les entrees validees', () => {
    const index = loadFaq('fr', join(FIXTURES, 'faq-ok'));

    expect(findFaqAnswer(index, 'fr', 'Comment ca marche ?')?.id).toBe('validee');
    expect(findFaqAnswer(index, 'fr', 'Une question pas encore relue ?')).toBeUndefined();
  });

  it('ne suggere que les entrees validees et suggerees', () => {
    const index = loadFaq('fr', join(FIXTURES, 'faq-ok'));
    expect(index.suggestions.map((entry) => entry.id)).toEqual(['validee']);
  });

  it('echoue si deux entrees portent la meme formulation normalisee', () => {
    expect(() => loadFaq('fr', join(FIXTURES, 'faq-doublon'))).toThrow(
      /premiere et seconde/,
    );
  });
});

describe('splitOffTopic', () => {
  it('reconnait la sentinelle entiere et coupe l appel amont', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(stream(['[[HORS_SUJET]]']), abort);

    expect(result.kind).toBe('off_topic');
    expect(abort.signal.aborted).toBe(true);
  });

  it('la reconnait coupee sur trois chunks', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(stream(['[[HORS', '_SUJ', 'ET]]']), abort);

    expect(result.kind).toBe('off_topic');
    expect(abort.signal.aborted).toBe(true);
  });

  it('tolere des espaces en tete', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(stream(['  \n', '[[HORS_SUJET]]']), abort);

    expect(result.kind).toBe('off_topic');
  });

  it('rend le buffer intact quand le debut y ressemble puis diverge', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(
      stream(['[[HORS', '_SUJET est une balise, pas une reponse.']),
      abort,
    );

    expect(result.kind).toBe('stream');
    if (result.kind !== 'stream') return;
    expect(await collect(result.chunks)).toBe(
      '[[HORS_SUJET est une balise, pas une reponse.',
    );
    expect(abort.signal.aborted).toBe(false);
  });

  it('restitue une reponse normale a l identique', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(
      stream(['OdyssAI ', 'est un jeu ', 'narratif.'], true),
      abort,
    );

    expect(result.kind).toBe('stream');
    if (result.kind !== 'stream') return;
    expect(await collect(result.chunks)).toBe('OdyssAI est un jeu narratif.');
  });

  it('laisse l usage accessible apres epuisement du flux', async () => {
    const abort = new AbortController();
    const result = await splitOffTopic(stream(['Une reponse.'], true), abort);

    expect(result.kind).toBe('stream');
    if (result.kind !== 'stream') return;

    expect(result.usage()).toBeUndefined();
    await collect(result.chunks);
    expect(result.usage()).toMatchObject({ inputTokens: 2_000, costUsd: 0.0009 });
  });

  it('laisse l usage accessible sur un hors-sujet quand il precede la sentinelle', async () => {
    async function* withUsageFirst(): AsyncIterable<LlmStreamEvent> {
      yield {
        type: 'usage',
        model: 'modele/de-test',
        inputTokens: 100,
        outputTokens: 1,
      };
      yield { type: 'text', text: '[[HORS_SUJET]]' };
    }

    const result = await splitOffTopic(withUsageFirst(), new AbortController());
    expect(result.kind).toBe('off_topic');
    if (result.kind !== 'off_topic') return;
    expect(result.usage).toMatchObject({ inputTokens: 100 });
  });
});
