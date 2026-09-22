import { describe, expect, it } from 'vitest';
import { CharacterService } from './character.service.js';
import { makeOnboardingPrisma, type OnboardingStore } from './testing/doubles.js';

const UNIVERSE_ID = '01860000-0000-7000-8000-0000000000a1';

function open(): CharacterService {
  const store: OnboardingStore = {
    users: [],
    universes: [],
    characters: [],
    messages: [],
    jobs: [],
  };

  return new CharacterService(makeOnboardingPrisma(store) as never);
}

describe('conversation de creation', () => {
  /*
    La table refuse deux messages de meme rang dans un canal. Le rang n'etant
    pas ecrit, tous partaient a zero et le deuxieme message de la conversation
    tombait sur la contrainte : la creation de personnage s'arretait au
    premier echange.
  */
  it('enchaine plusieurs echanges', async () => {
    const characters = open();

    await characters.recordUser(UNIVERSE_ID, 'Elle vient du nord.');
    await characters.recordAssistant(UNIVERSE_ID, 'Du nord. Son nom ?');
    await characters.recordUser(UNIVERSE_ID, 'Ael.');
    await characters.recordAssistant(UNIVERSE_ID, 'Ael, entendu.');

    const { messages } = await characters.conversation(UNIVERSE_ID);
    expect(messages).toHaveLength(4);
  });

  // L'ordre du journal suit le rang, pas l'horloge : quatre messages ecrits
  // dans la meme milliseconde doivent se relire dans l'ordre ou ils sont nes.
  it('rend les echanges dans l ordre ou ils ont ete dits', async () => {
    const characters = open();

    await characters.recordUser(UNIVERSE_ID, 'un');
    await characters.recordAssistant(UNIVERSE_ID, 'deux');
    await characters.recordUser(UNIVERSE_ID, 'trois');

    const { messages } = await characters.conversation(UNIVERSE_ID);
    expect(messages.map((message) => message.content)).toEqual([
      'un',
      'deux',
      'trois',
    ]);
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });

  // Le prompt lit la meme suite que l'ecran, sans les horodatages.
  it('donne au prompt la meme suite', async () => {
    const characters = open();

    await characters.recordUser(UNIVERSE_ID, 'un');
    await characters.recordAssistant(UNIVERSE_ID, 'deux');

    expect(await characters.history(UNIVERSE_ID)).toEqual([
      { role: 'user', content: 'un' },
      { role: 'assistant', content: 'deux' },
    ]);
  });
});
