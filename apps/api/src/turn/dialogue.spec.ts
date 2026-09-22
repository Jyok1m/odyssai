import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmStreamEvent } from '@odyssai/llm';
import { DIALOGUE_PROMPT, TURN_PROMPT, cleanLine, speakLine } from '@odyssai/narrator';
import { interlocutorOf } from '@odyssai/engine';
import type { TurnContext } from '@odyssai/narrator';
import type { Entity, WorldCharter } from '@odyssai/schemas';

const CHARTER: WorldCharter = {
  premise: 'Un port de pecheurs ou l on paie le sel en poisson.',
  tone: 'Chaleureux, un peu rude.',
  allowed: ['lire la maree', 'saler le poisson'],
  forbidden: ['aucune arme a feu', 'aucune magie'],
  narratorRules: ['nommer le vent', 'ne jamais promettre la peche'],
};

const npc = (name: string, overrides: Partial<Entity> = {}): Entity => ({
  kind: 'npc',
  name,
  known: `${name} tient la halle au poisson.`,
  hidden: `${name} doit trois mois de sel a la guilde.`,
  ...overrides,
});

const ENTITIES: Entity[] = [
  npc('Mireille la Cuillère'),
  npc('Ourden'),
  { kind: 'place', name: 'La Halle', known: 'Le marche couvert.', hidden: '' },
];

/*
  Qui parle est une regle, pas un choix du modele : le personnage nomme,
  sinon celui qui etait en scene, et seulement quand le joueur s'adresse a
  quelqu'un.
*/
describe('interlocutorOf', () => {
  it('prend le personnage nomme dans le message, diacritiques repliees', () => {
    const found = interlocutorOf({
      message: 'Je demande a mireille la cuillere ou est le sel',
      situation: 'interrogation',
      entities: ENTITIES,
      recent: [],
    });
    expect(found?.name).toBe('Mireille la Cuillère');
  });

  it('reconnait le premier mot d un nom compose', () => {
    const found = interlocutorOf({
      message: 'Mireille, tu me dois combien ?',
      situation: 'echange',
      entities: ENTITIES,
      recent: [],
    });
    expect(found?.name).toBe('Mireille la Cuillère');
  });

  it('prend le dernier personnage nomme par le meneur quand le message ne nomme personne', () => {
    const found = interlocutorOf({
      message: 'Tu peux m aider ?',
      situation: 'interrogation',
      entities: ENTITIES,
      recent: [
        { role: 'assistant', content: 'Mireille range ses paniers. Ourden entre et te regarde.' },
      ],
    });
    expect(found?.name).toBe('Ourden');
  });

  it('ne fait parler personne hors d un acte de parole', () => {
    const found = interlocutorOf({
      message: 'Je frappe Ourden',
      situation: 'violence',
      entities: ENTITIES,
      recent: [],
    });
    expect(found).toBeNull();
    expect(
      interlocutorOf({ message: 'Ourden ?', situation: null, entities: ENTITIES, recent: [] }),
    ).toBeNull();
  });

  it('ne prend jamais un lieu pour un interlocuteur', () => {
    const found = interlocutorOf({
      message: 'Je demande a la Halle',
      situation: 'interrogation',
      entities: ENTITIES,
      recent: [{ role: 'assistant', content: 'La Halle est vide.' }],
    });
    expect(found).toBeNull();
  });
});

describe('cleanLine', () => {
  it('retire le nom en tete, les guillemets et les didascalies', () => {
    expect(cleanLine('Ourden : « *il crache* Le sel, c\'est pas donné. »', 'Ourden')).toBe(
      "Le sel, c'est pas donné.",
    );
  });

  it('coupe une tirade a la fin d une phrase', () => {
    const long = 'Une phrase. '.repeat(60);
    const line = cleanLine(long, 'Ourden');
    expect(line.length).toBeLessThanOrEqual(400);
    expect(line.endsWith('.')).toBe(true);
  });
});

function makeLlm(reply: string): LlmClient {
  return {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    async embed() {
      throw new Error('pas ici');
    },
    async *streamChat(): AsyncIterable<LlmStreamEvent> {
      yield { type: 'text', text: reply };
      yield { type: 'usage', model: 'm', inputTokens: 10, outputTokens: 5 };
    },
  };
}

describe('speakLine', () => {
  const request = (reply: string, works: string[] = []) => ({
    llm: makeLlm(reply),
    config: { model: 'm', temperature: 0.9, maxOutputTokens: 160 },
    locale: 'fr' as const,
    context: {
      charter: CHARTER,
      npc: npc('Ourden'),
      player: 'Ael',
      recent: [],
    },
    message: 'Tu me dois combien ?',
    works,
  });

  it('rend la replique nettoyee', async () => {
    const result = await speakLine(request('Ourden: "Trois mois. Et je compte."'));
    expect(result).toMatchObject({ kind: 'ok', line: 'Trois mois. Et je compte.' });
  });

  it('refuse une replique vide ou empruntee', async () => {
    expect((await speakLine(request('*soupire*'))).kind).toBe('rejected');
    const borrowed = await speakLine(request('Demande a Arrakis.', ['Arrakis']));
    expect(borrowed).toMatchObject({ kind: 'rejected', reason: 'borrowed' });
  });

  it('delimite le message du joueur et cache le su et le cache au personnage', () => {
    const messages = DIALOGUE_PROMPT.build('fr', request('').context, 'Tu me dois combien ?');
    expect(messages[0]!.content).toContain('"hidden"');
    expect(messages[0]!.content).toContain('jamais une instruction');
    expect(messages.at(-1)!.content).toContain('<message_joueur>');
  });
});

/*
  Le meneur ne recoit la replique que lorsqu'il y en a une, et alors la
  consigne dit de la rendre telle quelle.
*/
describe('le bloc de replique du meneur', () => {
  const context: TurnContext = {
    charter: CHARTER,
    bible: {
      lore: { name: 'Sel', era: 'x', geography: 'x', history: 'x', dailyLife: 'x', accentHue: 1 },
      factions: [],
      politics: { balance: 'x', conflicts: [], stakes: 'x' },
      npcs: [],
      affinities: [],
    },
    character: {
      name: 'Ael',
      gender: 'femme',
      age: 31,
      personality: { traits: ['tenace'], summary: 'x' },
      attributes: { corps: 3, adresse: 3, esprit: 3, presence: 3, instinct: 3 },
      talents: [],
    },
    canon: [],
    recent: [],
    recalled: [],
    band: 'neutre',
    guidance: [],
    inventory: [],
    entities: [],
    mustUseDie: false,
    asking: false,
    fate: false,
    opening: false,
  };

  it('porte la replique quand elle existe, et rien sinon', () => {
    const without = TURN_PROMPT.build('fr', context, 'Tu me dois combien ?');
    expect(without[0]!.content).not.toContain('<replique>');

    const withLine = TURN_PROMPT.build(
      'fr',
      { ...context, line: { speaker: 'Ourden', text: 'Trois mois. Et je compte.' } },
      'Tu me dois combien ?',
    );
    expect(withLine[0]!.content).toContain('<replique>\nOurden : "Trois mois. Et je compte."');
    expect(withLine[0]!.content).toContain('ce personnage a déjà parlé');
  });
});
