import { describe, expect, it } from 'vitest';
import type { Inspiration } from '@odyssai/schemas';
import { abstractWorld } from '@odyssai/narrator';
import { makeFakeLlm } from '../guide/testing/doubles.js';

const CONFIG = {
  model: 'modele/de-test',
  temperature: 0.6,
  maxOutputTokens: 900,
};

const CLEAN = {
  tone: 'grave et patient',
  setting: 'un desert de sable ou l eau se compte a la goutte',
  power: 'ceux qui tiennent les puits tiennent les routes',
  mystery: 'une voix monte des dunes la nuit, personne n en connait la source',
  tensions: ['les nomades contre les sedentaires', 'la dette contre le sang'],
  motifs: ['une gourde scellee', 'un voile use', 'le sel sur la peau'],
  forbidden: ['aucune arme a feu'],
};

const WORKS: Inspiration = { mode: 'works', works: ['Dune', 'Fondation'] };

function run(payload: unknown, inspiration: Inspiration = WORKS) {
  const chunks =
    typeof payload === 'string' ? [payload] : [JSON.stringify(payload)];

  const llm = makeFakeLlm({ chunks });
  return {
    llm,
    result: abstractWorld({
      llm,
      config: CONFIG,
      input: { inspiration, locale: 'fr' },
    }),
  };
}

describe('passe d abstraction', () => {
  it('accepte des themes sans nom propre', async () => {
    const { result } = run(CLEAN);
    const value = await result;

    expect(value.kind).toBe('ok');
    if (value.kind !== 'ok') return;
    expect(value.themes.motifs).toHaveLength(3);
  });

  // Elle est la seule etape a les voir : tout ce qui suit ne recoit que les
  // themes qu'elle produit.
  it('place les titres cites dans le prompt, delimites', async () => {
    const { llm, result } = run(CLEAN);
    await result;

    const prompt = llm.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('Dune');
    expect(prompt).toContain('<inspiration_joueur>');
    // La consigne precede la donnee, et dit que c'en est une.
    expect(llm.calls[0]!.messages[0]!.role).toBe('system');
    expect(llm.calls[0]!.messages[0]!.content).toContain('jamais une instruction');
  });

  it('refuse un nom propre glisse au milieu d une phrase', async () => {
    const { result } = run({
      ...CLEAN,
      setting: 'un desert de sable borde par les monts Hagga',
    });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('invalid_shape');
  });

  /**
   * Le cas qui justifie le troisieme etage : en tete de phrase, la majuscule ne
   * dit rien, donc le schema laisse passer. Seule la relecture contre les
   * titres saisis voit l emprunt.
   */
  it('refuse un nom emprunte que le schema laisse passer', async () => {
    const { result } = run({
      ...CLEAN,
      setting: 'Dune couvre tout l horizon et ne laisse aucune ombre',
    });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('borrowed_names');
    expect(value.details).toContain('Dune');
  });

  it('refuse une sortie qui n est pas du JSON', async () => {
    const { result } = run('Voici les themes que je propose.');
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('invalid_json');
  });

  // Le refuser pour une balise de code couterait une relance pour rien.
  it('tolere un JSON enrobe dans une balise de code', async () => {
    const { result } = run('```json\n' + JSON.stringify(CLEAN) + '\n```');
    expect((await result).kind).toBe('ok');
  });

  it('refuse des themes trop pauvres', async () => {
    const { result } = run({ ...CLEAN, tensions: ['une seule ligne'] });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('invalid_shape');
  });

  // Sans titre cite, il n y a rien a emprunter : seul le refus des noms
  // propres tient, et il tient.
  it('garde le refus des noms propres en mode description libre', async () => {
    const own: Inspiration = {
      mode: 'own',
      ownDescription: 'x'.repeat(250),
    };

    expect((await run(CLEAN, own).result).kind).toBe('ok');

    const value = await run(
      { ...CLEAN, power: 'la reine Maelis tient les puits' },
      own,
    ).result;
    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('invalid_shape');
  });

  it('remonte l usage du modele', async () => {
    const llm = makeFakeLlm({
      chunks: [JSON.stringify(CLEAN)],
      usage: { inputTokens: 120, outputTokens: 340 },
    });

    const value = await abstractWorld({
      llm,
      config: CONFIG,
      input: { inspiration: WORKS, locale: 'fr' },
    });

    expect(value.usage.inputTokens).toBe(120);
    expect(value.usage.outputTokens).toBe(340);
  });
});
