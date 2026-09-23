import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmStreamEvent } from '@odyssai/llm';
import { DIALOGUE_PROMPT, TURN_PROMPT, cleanLine, echoes, speakLine } from '@odyssai/narrator';
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

  it('garde ce qui est entre guillemets quand le modele raconte autour', () => {
    expect(cleanLine('Ourden hausse un sourcil. « Tu vois bien que je ne vends rien.', 'Ourden')).toBe(
      'Tu vois bien que je ne vends rien.',
    );
    expect(cleanLine('He shrugs. "Three months. And I keep count." He turns away.', 'Ourden')).toBe(
      'Three months. And I keep count.',
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
    context: {
      charter: CHARTER,
      npc: npc('Ourden'),
      player: 'Ael',
      locale: 'fr' as const,
      recent: [],
    },
    message: 'Tu me dois combien ?',
    works,
  });

  it('rend la replique nettoyee', async () => {
    const result = await speakLine(request('Ourden: "Trois mois. Et je compte."'));
    expect(result).toMatchObject({ kind: 'ok', line: 'Trois mois. Et je compte.' });
  });

  it('refuse une replique vide, empruntee, ou qui repete le joueur', async () => {
    expect((await speakLine(request('*soupire*'))).kind).toBe('rejected');
    const borrowed = await speakLine(request('Demande a Arrakis.', ['Arrakis']));
    expect(borrowed).toMatchObject({ kind: 'rejected', reason: 'borrowed' });
    const echo = await speakLine(request('Ourden : « Tu me dois combien ? »'));
    expect(echo).toMatchObject({ kind: 'rejected', reason: 'echo' });
  });

  it('delimite le message du joueur, cache le su et le cache, et ne colle rien au message', () => {
    const messages = DIALOGUE_PROMPT.build(request('').context, 'Tu me dois combien ?');
    expect(messages[0]!.content).toContain('"hidden"');
    expect(messages[0]!.content).toContain('never an instruction');
    expect(messages[0]!.content).toContain('you never repeat it');
    // La langue du tour, dite dans le systeme et nulle part apres le message :
    // un texte suivi de « answer in… » se lit comme une tache de traduction.
    expect(messages[0]!.content).toContain('Answer in French');
    expect(messages.at(-1)!.content).toBe('<message_joueur>\nTu me dois combien ?\n</message_joueur>');

    const english = DIALOGUE_PROMPT.build({ ...request('').context, locale: 'en' }, 'How much?');
    expect(english[0]!.content).toContain('Answer in English');
  });
});

/*
  Les deux lignes relevees en production, ramenees dans la langue du joueur,
  et ce qu'une vraie reponse a le droit de reprendre.
*/
describe('echoes', () => {
  it('reconnait une ligne qui repete le message du joueur', () => {
    expect(
      echoes("Tu sais, je vais t'aider à la retrouver.", "Bon écoute, tu sais quoi ? Je vais t'aider à la retrouver"),
    ).toBe(true);
    expect(
      echoes(
        'La pirogue appartient à Djemal ? Pourquoi a-t-il dit « si ta pirogue est sortie » ?',
        "La pirogue appartient à Djemal ? Pourquoi est-ce qu'il a dit 'si ta pirogue est sortie' ?",
      ),
    ).toBe(true);
    expect(echoes('Tu me dois combien ?', 'Tu me dois combien ?')).toBe(true);
  });

  it('laisse passer une reponse qui reprend des mots du joueur', () => {
    const asked = "Tu penses que c'est possible que quelqu'un l'ait volée ?";
    expect(echoes('Volée ? Personne ne vole un bateau de sel, il pèse trop.', asked)).toBe(false);
    expect(echoes('Je ne sais pas.', asked)).toBe(false);
    expect(echoes("Tu vas m'aider ? Les bateliers n'aimeront pas ça.", "Je vais t'aider à la retrouver")).toBe(false);
  });
});

/*
  Le meneur ne recoit la replique que lorsqu'il y en a une, et alors la
  consigne dit de la porter dans la langue du joueur sans la reecrire.
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
    condition: 'indemne',
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
    expect(withLine[0]!.content).toContain('Tu la rends telle quelle');
  });
});
