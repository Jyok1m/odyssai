import { describe, expect, it } from 'vitest';
import type { LlmStreamEvent } from '@odyssai/llm';
import { CANON_MARKER, splitTail } from '@odyssai/narrator';

async function* stream(...texts: string[]): AsyncIterable<LlmStreamEvent> {
  for (const text of texts) yield { type: 'text', text };
  yield { type: 'usage', model: 'm', inputTokens: 10, outputTokens: 20 };
}

async function drain(split: ReturnType<typeof splitTail>) {
  let prose = '';
  for await (const chunk of split.chunks) prose += chunk;
  return {
    prose,
    tail: split.tail(),
    seen: split.seen(),
    usage: split.usage(),
  };
}

describe('decoupage en queue', () => {
  it('rend toute la prose quand il n y a pas de marqueur', async () => {
    const { prose, tail } = await drain(splitTail(stream('Le vent ', 'se leve.')));

    expect(prose).toBe('Le vent se leve.');
    expect(tail).toBe('');
  });

  it('separe la prose du bloc', async () => {
    const { prose, tail } = await drain(
      splitTail(stream('Tu avances.', CANON_MARKER, '{"kind":"action"}')),
    );

    expect(prose).toBe('Tu avances.');
    expect(tail).toBe('{"kind":"action"}');
  });

  /*
    Le cas qui justifie la fenetre glissante : le marqueur arrive coupe, et
    aucun de ses morceaux ne doit atteindre le joueur.
  */
  it('ne laisse fuir aucun fragment d un marqueur coupe en trois', async () => {
    const { prose, tail } = await drain(
      splitTail(stream('Tu avances.', '[[CA', 'NO', 'N]]{"kind":"action"}')),
    );

    expect(prose).toBe('Tu avances.');
    expect(prose).not.toContain('[');
    expect(tail).toBe('{"kind":"action"}');
  });

  it('ne laisse fuir aucun fragment, meme caractere par caractere', async () => {
    const { prose, tail } = await drain(
      splitTail(stream('Tu avances.', ...CANON_MARKER.split(''), '{}')),
    );

    expect(prose).toBe('Tu avances.');
    expect(tail).toBe('{}');
  });

  // Une amorce qui n'aboutit pas doit finir par etre rendue : c'est du recit.
  it('relache une amorce qui diverge', async () => {
    const { prose, tail } = await drain(
      splitTail(stream('Il ouvre [[la', ' porte.')),
    );

    expect(prose).toBe('Il ouvre [[la porte.');
    expect(tail).toBe('');
  });

  it('relache une amorce restee en suspens a la fin du flux', async () => {
    const { prose } = await drain(splitTail(stream('Fin du tour [[CA')));

    expect(prose).toBe('Fin du tour [[CA');
  });

  it('assemble un bloc arrive en plusieurs morceaux', async () => {
    const { tail } = await drain(
      splitTail(stream('Prose.', CANON_MARKER, '{"kind":', '"question"}')),
    );

    expect(tail).toBe('{"kind":"question"}');
  });

  // Un marqueur en tete est un tour sans prose, pas une erreur.
  it('supporte un marqueur sans prose devant', async () => {
    const { prose, tail } = await drain(splitTail(stream(CANON_MARKER + '{}')));

    expect(prose).toBe('');
    expect(tail).toBe('{}');
  });

  /*
    Le cas du marqueur de fiche : il ne porte rien, il signale. Une queue vide
    ne dit donc pas s'il est passe, et c'est `seen` qui tranche.
  */
  it('signale un marqueur qui ne laisse rien derriere lui', async () => {
    const { prose, tail, seen } = await drain(
      splitTail(stream('Je dresse ta fiche. ', '[[FI', 'CHE]]'), '[[FICHE]]'),
    );

    expect(prose).toBe('Je dresse ta fiche. ');
    expect(tail).toBe('');
    expect(seen).toBe(true);
  });

  it('ne signale rien quand le marqueur n arrive pas', async () => {
    const { seen } = await drain(
      splitTail(stream('Quel age a-t-il ?'), '[[FICHE]]'),
    );

    expect(seen).toBe(false);
  });

  it('remonte l usage, connu seulement a la fin', async () => {
    const split = splitTail(stream('Prose.'));
    expect(split.usage().inputTokens).toBeUndefined();

    const { usage } = await drain(split);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(20);
  });
});
