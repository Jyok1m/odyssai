import { describe, expect, it } from 'vitest';
import {
  CANON_MARKER,
  PARTY_TURN_PROMPT,
  PARTY_TURN_PROMPT_VERSION,
  playPartyTurn,
} from '@odyssai/narrator';
import type { PartyTurnContext } from '@odyssai/narrator';
import { makeFakeLlm } from '../guide/testing/doubles.js';

const ACTORS = [
  {
    name: 'Ael',
    summary: 'Cartographe en fuite.',
    condition: 'indemne' as const,
    active: true,
  },
  {
    name: 'Ourden',
    summary: 'Garde de nuit, endetté.',
    condition: 'blesse' as const,
    active: false,
  },
];

const CONTEXT = {
  charter: {
    premise: 'p',
    tone: 't',
    allowed: ['a', 'b'],
    forbidden: ['c', 'd'],
    narratorRules: ['e', 'f'],
  },
  bible: {} as never,
  character: { name: 'Ael' } as never,
  canon: [],
  recent: [],
  recalled: [],
  band: 'partiel',
  guidance: [],
  inventory: ['une torche'],
  condition: 'indemne' as const,
  asking: false,
  mustUseDie: false,
  fate: false,
  opening: false,
  entities: [],
  party: { actors: ACTORS },
};

const party = (extra: Record<string, unknown>) =>
  PARTY_TURN_PROMPT.build(
    'fr',
    { ...CONTEXT, ...extra } as PartyTurnContext,
    'je cherche la sortie',
  );

const system = (extra: Record<string, unknown>) => party(extra)[0]!.content;

/*
  Le prompt de partie : les memes blocs que le tour solo, des consignes dites
  pour un groupe. Ce qui doit se voir : la table, qui agit, et l'interdit de
  jouer un personnage qui n'est pas le sien.
*/
describe('le prompt de tour de partie', () => {
  it('porte la version de partie, distincte du solo', () => {
    expect(PARTY_TURN_PROMPT_VERSION).toBe('turn/party/v1');
    expect(PARTY_TURN_PROMPT_VERSION).not.toBe('turn/v23');
  });

  it('montre la table, et qui agit ce tour', () => {
    const content = system({});
    expect(content).toContain('<groupe>');
    expect(content).toContain('Ael (indemne) : Cartographe en fuite. agit ce tour');
    expect(content).toContain('Ourden (blesse) : Garde de nuit, endetté.');
  });

  it('dit les regles du groupe, qui ne sont pas celles du solo', () => {
    const content = system({});
    expect(content).toContain('Plusieurs joueurs partagent cette histoire');
    expect(content).toContain('ni celui dont c\'est le tour, ni les autres');
    expect(content).toContain('rends la main au groupe');
  });

  // Le message du joueur reste une donnee delimitee, comme au solo.
  it('delimite le message du joueur actif', () => {
    const messages = party({});
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('<message_joueur>');
    expect(last.content).toContain('je cherche la sortie');
  });

  /*
    L'ouverture se joue sans message : personne n'a rien dit, et preter des
    mots au groupe serait jouer a sa place. La scene situe le groupe, pas un
    personnage seul.
  */
  it('situe le groupe a l ouverture, sans message prete', () => {
    const messages = party({ opening: true });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('qui ils sont là-dedans, ensemble');
  });

  it('garde la queue de canon, comme le solo', () => {
    const content = system({});
    expect(content).toContain(CANON_MARKER);
    expect(content).toContain('"gained"');
  });

  it('s ecrit aussi en anglais', () => {
    const content = PARTY_TURN_PROMPT.build(
      'en',
      { ...CONTEXT, party: { actors: ACTORS } } as PartyTurnContext,
      'I look for the way out',
    )[0]!.content;
    expect(content).toContain('Several players share this story');
    expect(content).toContain('The group');
  });
});

/*
  Le tour de partie se joue comme le tour solo : le flux arrive au fil de
  l'eau, la queue se lit, et rien ne change pour l'appelant.
*/
describe('playPartyTurn', () => {
  it('diffuse le recit et lit la queue', async () => {
    const llm = makeFakeLlm({
      chunks: ['La porte cède.', ` ${CANON_MARKER} {"kind":"action"}`],
    });

    const played = playPartyTurn({
      llm,
      config: { model: 'modele/de-test', temperature: 0.6, maxOutputTokens: 900 },
      locale: 'fr',
      context: CONTEXT as PartyTurnContext,
      message: 'je force la porte',
    });

    const chunks: string[] = [];
    for await (const text of played.chunks) chunks.push(text);

    // La queue ne se diffuse pas : elle est pour le code, pas pour l'ecran.
    const streamed = chunks.join('');
    expect(streamed).toContain('La porte cède.');
    expect(streamed).not.toContain(CANON_MARKER);

    expect(played.delta().kind).toBe('action');
    // Le prompt parti est bien celui de la table.
    expect(llm.calls[0]!.messages[0]!.content).toContain('<groupe>');
  });
});
