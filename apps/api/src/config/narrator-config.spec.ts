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
  /*
    Les modeles vivent en code, un par role : une variable d'environnement qui
    pretendrait en poser un est ignoree, et le corps supplementaire, lui, se
    retrouve sur chaque role parce qu'il depend du fournisseur.
  */
  it('sert un modele par role, depuis le code et non depuis l environnement', () => {
    const config = makeConfig({
      LLM_NARRATOR_MODEL: 'un/modele-ignore',
      LLM_NARRATOR_EXTRA_BODY: '{"reasoning":{"effort":"none"}}',
    });

    expect(config.modelFor('turn').model).not.toBe('un/modele-ignore');
    expect(config.modelFor('turn').model).not.toBe(config.modelFor('extract').model);
    expect(config.modelFor('extract').temperature).toBeLessThan(config.modelFor('turn').temperature);
    expect(config.modelFor('lore').extraBody).toEqual({ reasoning: { effort: 'none' } });
    expect(config.candidates).toEqual([]);
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
