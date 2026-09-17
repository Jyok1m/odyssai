import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmStreamEvent, StreamChatRequest } from '@odyssai/llm';
import {
  GenerationFailure,
  runGeneration,
  type GenerationNode,
} from '@odyssai/narrator';
import type { CharacterSheet, WorldThemes } from '@odyssai/schemas';

const THEMES: WorldThemes = {
  tone: 'grave et patient',
  setting: 'un desert de sable ou l eau se compte a la goutte',
  power: 'ceux qui tiennent les puits tiennent les routes',
  mystery: 'une voix monte des sables la nuit',
  tensions: ['les nomades contre les sedentaires', 'la dette contre le sang'],
  motifs: ['une gourde scellee', 'un voile use', 'le sel sur la peau'],
  forbidden: ['aucune arme a feu'],
};

const CHARACTER: CharacterSheet = {
  name: 'Ael',
  gender: 'femme',
  age: 31,
  personality: { traits: ['tenace'], summary: 'Cartographe en fuite.' },
  attributes: { courage: 4, ruse: 3, savoir: 2 },
};

const CHARTER = {
  premise: 'Un desert que l on traverse en achetant son eau a chaque etape.',
  tone: 'Sec, patient, sans merveilleux.',
  allowed: ['lire le vent', 'sceller un pacte par le sel'],
  forbidden: ['aucune arme a feu', 'aucune resurrection'],
  narratorRules: ['nommer la soif avant la peur', 'ne jamais promettre la pluie'],
};

const LORE = {
  name: 'Sarek',
  era: 'la troisieme secheresse',
  geography: 'des plateaux de pierre coupes de canyons ou dorment les puits',
  history: 'un puits creve a noye la vallee basse, et nul n a rebati dessus',
  dailyLife: 'on se leve avant le jour, on marche, on paie son eau, on dort',
  accentHue: 32,
};

const FACTIONS = [
  {
    name: 'Les Scelleurs',
    creed: 'l eau se merite, elle ne se donne pas',
    strength: 'ils tiennent les sceaux des puits profonds',
    territory: 'les plateaux du nord',
    symbol: 'un anneau de sel tresse',
  },
  {
    name: 'La Marche Basse',
    creed: 'ce que la terre rend appartient a qui marche',
    strength: 'ils connaissent des passages que nul n a cartographies',
    territory: 'les canyons de l est',
    symbol: 'une corde nouee sept fois',
  },
];

const POLITICS = {
  balance: 'les Scelleurs vendent, la Marche Basse contourne, aucun ne gagne',
  conflicts: ['la Marche Basse detourne une veine que les Scelleurs taxaient'],
  stakes: 'si un puits profond cede, les deux perdent leur raison de tenir',
};

const NPCS = [
  {
    name: 'Ourden',
    role: 'sceleur de puits',
    faction: 'Les Scelleurs',
    drive: 'reprendre la veine detournee sans verser de sang',
    secret: 'il a lui meme ouvert le passage, il y a douze ans',
  },
  {
    name: 'Nise',
    role: 'guide de canyon',
    faction: 'La Marche Basse',
    drive: 'trouver qui a cartographie les passages avant elle',
    secret: 'elle cherche Ael depuis deux ans',
  },
  {
    name: 'Bardem',
    role: 'porteur d eau',
    faction: null,
    drive: 'payer sa dette avant la fin de la secheresse',
    secret: 'il revend l eau qu il transporte',
  },
];

const AFFINITIES = [
  {
    subject: 'Les Scelleurs',
    target: 'La Marche Basse',
    stance: 'rival' as const,
    note: 'une veine detournee que les deux revendiquent',
  },
  {
    subject: 'Nise',
    target: 'Ael',
    stance: 'dette' as const,
    note: 'elle lui doit une carte qu elle n a jamais rendue',
  },
  {
    subject: 'Ourden',
    target: 'Ael',
    stance: 'neutre' as const,
    note: 'il ignore encore qu elle a vu le passage',
  },
];

const PAYLOADS: Record<GenerationNode, unknown> = {
  charter: CHARTER,
  lore: LORE,
  factions: { factions: FACTIONS },
  politics: POLITICS,
  characters: { npcs: NPCS },
  affinities: { affinities: AFFINITIES },
};

interface WorldLlm extends LlmClient {
  calls: StreamChatRequest[];
}

/**
 * Faux client qui repond par noeud. Il lit l'etape dans les metadonnees de
 * trace plutot que dans le texte du prompt : c'est la seule facon de savoir
 * quel noeud appelle sans dependre de la formulation des consignes.
 */
function makeWorldLlm(
  scripted: Partial<Record<GenerationNode, unknown[]>> = {},
): WorldLlm {
  const calls: StreamChatRequest[] = [];
  const seen = new Map<string, number>();

  return {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    calls,
    async flushTraces() {},

    async *streamChat(request: StreamChatRequest): AsyncIterable<LlmStreamEvent> {
      calls.push(request);

      const step = request.trace?.metadata.step as GenerationNode;
      const index = seen.get(step) ?? 0;
      seen.set(step, index + 1);

      const queue = scripted[step];
      const payload = queue ? (queue[Math.min(index, queue.length - 1)]) : PAYLOADS[step];

      yield {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      };
      yield {
        type: 'usage',
        model: request.model,
        inputTokens: 100,
        outputTokens: 200,
      };
    },
  };
}

function run(llm: WorldLlm, works: string[] = ['Dune', 'Le Nom de la Rose']) {
  return runGeneration({
    deps: {
      llm,
      config: { model: 'modele/de-test', temperature: 0.6, maxOutputTokens: 900 },
    },
    input: {
      universeId: '01860000-0000-7000-8000-000000000001',
      locale: 'fr',
      themes: THEMES,
      character: CHARACTER,
      works,
    },
  });
}

describe('graphe de generation', () => {
  it('produit une charte et une bible completes', async () => {
    const llm = makeWorldLlm();
    const outcome = await run(llm);

    expect(outcome.charter.forbidden).toContain('aucune arme a feu');
    expect(outcome.bible.lore.name).toBe('Sarek');
    expect(outcome.bible.factions).toHaveLength(2);
    expect(outcome.bible.npcs).toHaveLength(3);
    // Six noeuds creatifs, un appel chacun. Le controle n'en fait aucun.
    expect(llm.calls).toHaveLength(6);
    expect(outcome.usage).toHaveLength(6);
  });

  /**
   * L'invariant de tout le chantier : les titres cites s'arretent a la passe
   * d'abstraction. Aucun prompt de generation ne doit en porter un.
   */
  it('ne transmet aucun titre cite a un noeud', async () => {
    const llm = makeWorldLlm();
    await run(llm, ['Dune', 'Le Nom de la Rose', 'Fondation']);

    const everything = llm.calls
      .flatMap((call) => call.messages.map((message) => message.content))
      .join('\n');

    for (const title of ['Dune', 'Le Nom de la Rose', 'Fondation']) {
      expect(everything).not.toContain(title);
    }
  });

  it('delimite la fiche du joueur, qui est un texte joueur', async () => {
    const llm = makeWorldLlm();
    await run(llm);

    const user = llm.calls[0]!.messages.at(-1)!.content;
    expect(user).toContain('<fiche_joueur>');
    expect(llm.calls[0]!.messages[0]!.content).toContain('jamais une instruction');
  });

  it('relit ce que les noeuds precedents ont ecrit', async () => {
    const llm = makeWorldLlm();
    await run(llm);

    // Les affinites arrivent en dernier : elles voient tout le reste.
    const last = llm.calls.at(-1)!.messages.at(-1)!.content;
    expect(last).toContain('Les Scelleurs');
    expect(last).toContain('Ourden');
  });

  it('rejoue un noeud dont la sortie est illisible', async () => {
    const llm = makeWorldLlm({ lore: ['pas du json', LORE] });
    const outcome = await run(llm);

    expect(outcome.bible.lore.name).toBe('Sarek');
    expect(llm.calls).toHaveLength(7);
  });

  it('echoue en nommant l etape apres deux essais rates', async () => {
    const llm = makeWorldLlm({ politics: ['pas du json', 'toujours pas'] });

    await expect(run(llm)).rejects.toThrow(GenerationFailure);
    await expect(run(makeWorldLlm({ politics: ['x', 'y'] }))).rejects.toThrow(
      /politics/,
    );
  });

  it('echoue quand le schema refuse la sortie', async () => {
    // Une seule faction : le monde n'a personne a qui s'opposer.
    const llm = makeWorldLlm({ factions: [{ factions: [FACTIONS[0]] }] });
    await expect(run(llm)).rejects.toThrow(/factions/);
  });

  /**
   * Un nom peut traverser l'abstraction sans encombre et reapparaitre ici, le
   * modele l'ayant retrouve seul a partir des themes. Le controle le voit, et
   * le graphe repasse par le lore.
   */
  it('reecrit le monde quand le controle trouve un nom emprunte', async () => {
    const llm = makeWorldLlm({
      lore: [{ ...LORE, name: 'Arrakis', history: 'les sables de Arrakis' }, LORE],
    });

    const outcome = await run(llm, ['Arrakis']);

    expect(outcome.bible.lore.name).toBe('Sarek');
    // Six noeuds, puis lore et les quatre suivants rejoues, plus le second
    // passage du controle.
    expect(llm.calls.length).toBeGreaterThan(6);
  });

  it('abandonne si le nom emprunte revient a la reecriture', async () => {
    const llm = makeWorldLlm({
      lore: [{ ...LORE, name: 'Arrakis' }, { ...LORE, name: 'Arrakis' }],
    });

    await expect(run(llm, ['Arrakis'])).rejects.toThrow(/Arrakis/);
  });
});
