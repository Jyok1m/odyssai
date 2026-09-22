import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmStreamEvent } from '@odyssai/llm';
import { TURN_PROMPT, describeEntity } from '@odyssai/narrator';
import { revealLore, seedEntities } from '@odyssai/engine';
import { TurnDeltaSchema, type Entity, type WorldBible } from '@odyssai/schemas';

const BIBLE = {
  lore: { name: 'Sarek', era: 'e', geography: 'g', history: 'h', dailyLife: 'd', accentHue: 10 },
  factions: [
    { name: 'Les Tisserands', creed: 'Nos liens tiennent.', strength: 's', territory: 'Les vallees.', symbol: 'y' },
    { name: 'Les Veilleurs', creed: 'Le calme.', strength: 's', territory: 'Les cols.', symbol: 'y' },
  ],
  politics: { tensions: ['t'], balance: 'b' },
  npcs: [
    { name: 'Elara', role: 'Scribe', faction: 'Les Tisserands', drive: 'Proteger le village.', secret: 'Elle a vendu le passage.' },
    { name: 'Kaelen', role: 'Maitre', faction: null, drive: 'Former.', secret: 'Il a peur du feu.' },
    { name: 'elara', role: 'Doublon', faction: null, drive: 'd', secret: 's' },
  ],
  affinities: [
    { subject: 'Elara', target: 'Kaelen', stance: 'allie', note: 'n' },
    { subject: 'Kaelen', target: 'Elara', stance: 'neutre', note: 'n' },
    { subject: 'Elara', target: 'Les Veilleurs', stance: 'rival', note: 'n' },
  ],
} as unknown as WorldBible;

describe('ce que la generation seme', () => {
  const seeded = seedEntities(BIBLE);

  it('donne aux personnages leur secret, et rien de cache aux factions', () => {
    const elara = seeded.find((entity) => entity.name === 'Elara')!;
    expect(elara.kind).toBe('npc');
    expect(elara.known).toContain('Scribe');
    expect(elara.hidden).toBe('Elle a vendu le passage.');

    const veilleurs = seeded.find((entity) => entity.name === 'Les Veilleurs')!;
    expect(veilleurs.kind).toBe('faction');
    expect(veilleurs.hidden).toBeNull();
  });

  // Une bible peut nommer deux fois la meme chose : la premiere l'emporte.
  it('ne seme pas deux fois le meme nom, casse comprise', () => {
    expect(seeded.filter((entity) => entity.name.toLowerCase() === 'elara')).toHaveLength(1);
    expect(seeded.find((entity) => entity.name === 'Elara')!.known).toContain('Scribe');
  });
});

describe('la revelation', () => {
  const entity: Entity = { name: 'Elara', kind: 'npc', known: 'Scribe.', hidden: 'Elle a vendu le passage.' };

  it('verse le cache dans le su', () => {
    const revealed = revealLore(entity);
    expect(revealed.hidden).toBeNull();
    expect(revealed.known).toContain('Scribe.');
    expect(revealed.known).toContain('Elle a vendu le passage.');
  });

  // Une revelation ne se defait pas, et ne se refait pas non plus.
  it('ne change rien a ce qui est deja su', () => {
    const once = revealLore(entity);
    expect(revealLore(once)).toEqual(once);
  });
});

describe('ce que le meneur declare', () => {
  it('borne les noms nouveaux et tolere les absents', () => {
    const delta = TurnDeltaSchema.parse({ kind: 'action', usedDie: false });
    expect(delta.met).toEqual([]);
    expect(delta.revealed).toEqual([]);

    const three = TurnDeltaSchema.safeParse({
      kind: 'action',
      usedDie: false,
      met: [1, 2, 3].map((n) => ({ name: `Nom ${n}`, kind: 'npc', hint: 'vu au marche' })),
    });
    expect(three.success).toBe(false);
  });

  it('refuse un genre accentue ou inconnu', () => {
    expect(
      TurnDeltaSchema.safeParse({
        kind: 'action',
        usedDie: false,
        met: [{ name: 'Orin', kind: 'personnage', hint: 'vu au marche' }],
      }).success,
    ).toBe(false);
  });
});

describe('ce que le meneur recoit', () => {
  const context = {
    charter: { premise: 'p', tone: 't', allowed: ['a', 'b'], forbidden: ['c', 'd'], narratorRules: ['e', 'f'] },
    bible: BIBLE,
    character: {} as never,
    canon: [],
    recent: [],
    recalled: [],
    band: 'partiel',
    guidance: [],
    inventory: [],
    asking: false,
    mustUseDie: false,
    fate: false,
    opening: false,
    act: undefined,
    entities: seedEntities(BIBLE),
  };
  const system = TURN_PROMPT.build('fr', context as never, 'je regarde')[0]!.content;

  it('lit les entites, cache compris', () => {
    expect(system).toContain('<entites>');
    expect(system).toContain('Elara (npc)');
    expect(system).toContain('cache : Elle a vendu le passage.');
  });

  /*
    Les personnages ne sont plus dans <monde> : deux copies d'un meme secret
    finiraient par diverger, et c'est <entites> qui grandit.
  */
  it('ne recopie pas les personnages dans le monde', () => {
    const monde = system.slice(system.indexOf('<monde>'), system.indexOf('</monde>'));
    expect(monde).not.toContain('"npcs"');
    expect(monde).not.toContain('Elle a vendu le passage.');
  });
});

/*
  Un fragment de lore, avec un faux modele : le chemin qui compte est celui
  ou la prose emprunte un nom aux oeuvres citees, et doit etre refusee.
*/
function fakeLlm(answers: string[]): LlmClient {
  let call = 0;
  return {
    provider: 'openrouter',
    baseUrl: 'x',
    async embed() {
      return { vectors: [], model: 'm', inputTokens: 0 };
    },
    async *streamChat(): AsyncIterable<LlmStreamEvent> {
      const text = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      yield { type: 'text', text };
      yield { type: 'usage', model: 'm', inputTokens: 1, outputTokens: 1 };
    },
  };
}

const CONTEXT = {
  charter: { premise: 'p', tone: 't', allowed: ['a', 'b'], forbidden: ['c', 'd'], narratorRules: ['e', 'f'] },
  lore: BIBLE.lore,
  factions: ['Les Tisserands'],
  existing: ['Elara'],
  entity: { name: 'Orin', kind: 'npc' as const, hint: 'un eclaireur vu au col' },
};

describe('le fragment de lore', () => {
  it('accepte une sortie qui tient', async () => {
    const result = await describeEntity({
      llm: fakeLlm(['{"known":"Un eclaireur des cols, connu des Tisserands.","hidden":"Il a menti sur son nom au village."}']),
      config: { model: 'm', temperature: 0.5, maxOutputTokens: 300 },
      locale: 'fr',
      works: ['Dune'],
      context: CONTEXT,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.fragment.hidden).toContain('menti');
  });

  it('refuse un titre recopie des oeuvres citees', async () => {
    const result = await describeEntity({
      llm: fakeLlm(['{"known":"Un eclaireur qui sert le Trone de Fer.","hidden":"Il doit tout au Trone de Fer."}']),
      config: { model: 'm', temperature: 0.5, maxOutputTokens: 300 },
      locale: 'fr',
      works: ['Le Trone de Fer'],
      context: CONTEXT,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.reason).toBe('borrowed');
  });

  // Une sortie illisible se rejoue une fois, comme un noeud du graphe.
  it('rejoue une fois une sortie illisible', async () => {
    const result = await describeEntity({
      llm: fakeLlm(['pas du json', '{"known":"Un eclaireur des cols.","hidden":"Il doit une vie a Elara."}']),
      config: { model: 'm', temperature: 0.5, maxOutputTokens: 300 },
      locale: 'fr',
      works: [],
      context: CONTEXT,
    });
    expect(result.kind).toBe('ok');
  });
});
