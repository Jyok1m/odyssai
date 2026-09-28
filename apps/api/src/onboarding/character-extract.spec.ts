import { describe, expect, it } from 'vitest';
import { LlmError } from '@odyssai/llm';
import { extractCharacter, type ConversationTurn } from '@odyssai/narrator';
import { makeFakeLlm, type FakeLlmOptions } from '../guide/testing/doubles.js';

const CONFIG = {
  model: 'modele/de-test',
  temperature: 0.2,
  maxOutputTokens: 500,
};

const SHEET = {
  name: 'Ael',
  gender: 'femme',
  age: 31,
  personality: { traits: ['tenace'], summary: 'Cartographe en fuite.' },
  attributes: { corps: 3, adresse: 4, esprit: 2, presence: 3, instinct: 4 },
};

const HISTORY: ConversationTurn[] = [
  { role: 'user', content: 'Elle s appelle Ael.' },
  { role: 'assistant', content: 'Ael. Quel age ?' },
  { role: 'user', content: 'Trente et un ans.' },
];

function run(options: FakeLlmOptions) {
  const llm = makeFakeLlm(options);
  return {
    llm,
    result: extractCharacter({ llm, config: CONFIG, locale: 'fr', history: HISTORY }),
  };
}

/*
  La fiche est ce qui sort de douze echanges payes. Sans rejeu, un seul mauvais
  tirage les emportait tous, et le joueur lisait "indisponible" sans savoir
  qu'un second clic aurait suffi.
*/
describe('extraction de la fiche', () => {
  it('rend la fiche du premier coup', async () => {
    const { llm, result } = run({ chunks: [JSON.stringify(SHEET)] });
    const value = await result;

    expect(value.kind).toBe('ok');
    if (value.kind !== 'ok') return;
    expect(value.character.name).toBe('Ael');
    expect(llm.calls).toHaveLength(1);
  });

  it('rejoue une sortie illisible et garde la seconde', async () => {
    const { llm, result } = run({
      replies: [['Voici la fiche que je propose.'], [JSON.stringify(SHEET)]],
    });
    const value = await result;

    expect(value.kind).toBe('ok');
    if (value.kind !== 'ok') return;
    expect(value.character.name).toBe('Ael');
    expect(llm.calls).toHaveLength(2);
  });

  it('s arrete apres deux sorties illisibles', async () => {
    const { llm, result } = run({ chunks: ['Je ne sais pas.'] });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('invalid_json');
    expect(value.attempts).toBe(2);
    expect(llm.calls).toHaveLength(2);
  });

  /*
    Une sortie coupee par le plafond ne se lit pas comme un mauvais tirage : le
    meme plafond coupera le rejeu au meme endroit, et c'est un chiffre a
    relever, pas un modele a relancer.
  */
  it('nomme une sortie coupee par le plafond', async () => {
    const { llm, result } = run({
      chunks: [JSON.stringify(SHEET).slice(0, 40)],
      stop: 'length',
    });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('truncated');
    // Elle rejoue quand meme : le plafond a pu etre mange par un preambule,
    // qui ne revient pas forcement au tirage suivant.
    expect(llm.calls).toHaveLength(2);
  });

  // `partial` n'est pas un echec : un age fantaisiste ne vaut pas un appel de
  // plus, et l'ecran demande ce qui manque.
  it('garde une fiche partielle sans rejouer', async () => {
    const { llm, result } = run({
      chunks: [JSON.stringify({ ...SHEET, age: 9000 })],
    });
    const value = await result;

    expect(value.kind).toBe('ok');
    if (value.kind !== 'ok') return;
    expect(value.missing).toEqual(['age']);
    expect(llm.calls).toHaveLength(1);
  });

  // Rien de retenu n'est pas une fiche partielle : c'est un formulaire vide.
  it('rejoue une fiche dont aucun champ ne tient', async () => {
    const { llm, result } = run({
      replies: [['{}'], [JSON.stringify(SHEET)]],
    });
    const value = await result;

    expect(value.kind).toBe('ok');
    expect(llm.calls).toHaveLength(2);
  });

  it('nomme une fiche vide quand les deux essais le sont', async () => {
    const { result } = run({ chunks: ['{}'] });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('empty');
  });

  it('rejoue une panne de transport', async () => {
    const { llm, result } = run({
      failCalls: [1],
      chunks: [JSON.stringify(SHEET)],
    });

    expect((await result).kind).toBe('ok');
    expect(llm.calls).toHaveLength(2);
  });

  // Un refus franc du fournisseur n'est pas un accident : la requete est en
  // cause, et le rejouer fait payer deux fois le meme refus.
  it('ne rejoue pas un refus franc du fournisseur', async () => {
    const { llm, result } = run({
      fail: true,
      failWith: new LlmError('appel refuse par le fournisseur (HTTP 400)', {
        status: 400,
        retryable: false,
      }),
    });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.reason).toBe('upstream');
    expect(value.attempts).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  /*
    Un joueur parti arrive ici sous cette forme : c'est `toLlmError` qui
    traduit l'abandon du SDK, et `guide-llm.spec.ts` verifie qu'il le classe
    bien non retentable. Le rejouer ferait payer un appel que plus personne ne
    lira.
  */
  it('ne rejoue pas un joueur parti', async () => {
    const { llm, result } = run({
      fail: true,
      failWith: new LlmError('appel interrompu', { retryable: false }),
    });
    const value = await result;

    expect(value.kind).toBe('rejected');
    if (value.kind !== 'rejected') return;
    expect(value.attempts).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  // Chaque essai a ete paye : un rejeu muet ferait mentir le cout d'une fiche.
  it('rend l usage de chaque essai', async () => {
    const { result } = run({
      replies: [['illisible'], [JSON.stringify(SHEET)]],
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    const value = await result;

    expect(value.usages).toHaveLength(2);
    expect(value.usages[0]!.inputTokens).toBe(120);
  });

  // L'essai voyage dans la trace : deux appels pour une fiche se lisent
  // autrement que deux fiches.
  it('numerote ses essais dans la trace', async () => {
    const llm = makeFakeLlm({ chunks: ['illisible'] });

    await extractCharacter({
      llm,
      config: CONFIG,
      locale: 'fr',
      history: HISTORY,
      trace: { name: 'character-extract', metadata: { universe_id: 'u1' } },
    });

    expect(llm.calls.map((call) => call.trace?.metadata.attempt)).toEqual([1, 2]);
  });
});
