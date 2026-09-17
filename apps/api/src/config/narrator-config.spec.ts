import { describe, expect, it } from 'vitest';
import { NarratorConfig } from './narrator-config.js';

function makeConfig(overrides: Record<string, string> = {}): NarratorConfig {
  const previous = process.env;
  process.env = { ...previous, ...overrides } as NodeJS.ProcessEnv;
  try {
    return new NarratorConfig();
  } finally {
    process.env = previous;
  }
}

describe('NarratorConfig', () => {
  // L'api doit demarrer sans : la narration n'est lue par aucune route.
  it('accepte un modele absent, et le dit', () => {
    const config = makeConfig({ LLM_NARRATOR_MODEL: '' });

    expect(config.configured).toBe(false);
    expect(config.candidates).toEqual([]);
  });

  it('reconnait un modele retenu', () => {
    expect(makeConfig({ LLM_NARRATOR_MODEL: 'un/modele' }).configured).toBe(true);
  });

  it('decoupe les candidats et ignore les blancs', () => {
    const config = makeConfig({
      LLM_NARRATOR_CANDIDATES: ' a/modele , b/modele ,, c/modele ',
    });

    expect(config.candidates).toEqual(['a/modele', 'b/modele', 'c/modele']);
  });

  it('refuse un extra body qui n est pas un objet JSON', () => {
    expect(() => makeConfig({ LLM_NARRATOR_EXTRA_BODY: '[1,2]' })).toThrow(
      /objet JSON attendu/,
    );
  });

  // L'API d'OpenAI rejette les arguments qu'elle ne connait pas : mieux vaut
  // tomber au demarrage qu'au premier monde genere.
  it('refuse une cle propre a OpenRouter avec le fournisseur openai', () => {
    expect(() =>
      makeConfig({
        LLM_NARRATOR_PROVIDER: 'openai',
        LLM_NARRATOR_EXTRA_BODY: '{"provider":{"data_collection":"deny"}}',
      }),
    ).toThrow(/OpenRouter/);
  });

  it('prend la cle du fournisseur choisi', () => {
    const config = makeConfig({
      LLM_NARRATOR_PROVIDER: 'openai',
      LLM_NARRATOR_EXTRA_BODY: '{}',
      OPENAI_API_KEY: 'sk-factice',
      OPENROUTER_API_KEY: 'sk-or-factice',
    });

    expect(config.apiKey).toBe('sk-factice');
  });
});
