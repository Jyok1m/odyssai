import { describe, expect, it } from 'vitest';
import { CharacterService } from './character.service.js';
import { LockedError } from './onboarding.service.js';
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

    await characters.recordUser(UNIVERSE_ID, null, 'Elle vient du nord.');
    await characters.recordAssistant(UNIVERSE_ID, null, 'Du nord. Son nom ?');
    await characters.recordUser(UNIVERSE_ID, null, 'Ael.');
    await characters.recordAssistant(UNIVERSE_ID, null, 'Ael, entendu.');

    const { messages } = await characters.conversation(UNIVERSE_ID, null);
    expect(messages).toHaveLength(4);
  });

  // L'ordre du journal suit le rang, pas l'horloge : quatre messages ecrits
  // dans la meme milliseconde doivent se relire dans l'ordre ou ils sont nes.
  it('rend les echanges dans l ordre ou ils ont ete dits', async () => {
    const characters = open();

    await characters.recordUser(UNIVERSE_ID, null, 'un');
    await characters.recordAssistant(UNIVERSE_ID, null, 'deux');
    await characters.recordUser(UNIVERSE_ID, null, 'trois');

    const { messages } = await characters.conversation(UNIVERSE_ID, null);
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

    await characters.recordUser(UNIVERSE_ID, null, 'un');
    await characters.recordAssistant(UNIVERSE_ID, null, 'deux');

    expect(await characters.history(UNIVERSE_ID, null)).toEqual([
      { role: 'user', content: 'un' },
      { role: 'assistant', content: 'deux' },
    ]);
  });
});

/*
  Dans une table, la remise a zero ne touche que son fil et sa fiche, et
  jamais une fiche deja payee : le siege resterait pret sans fiche, et la
  generation l'ecarterait sans rien dire.
*/
describe('remise a zero dans une table', () => {
  const NOW = new Date();

  function seated(ready: boolean) {
    const store: OnboardingStore = {
      users: [],
      universes: [],
      characters: [
        { id: 'fiche', universeId: UNIVERSE_ID, ownerId: 'joueur', name: 'Ael' } as never,
        { id: 'autre', universeId: UNIVERSE_ID, ownerId: 'voisin', name: 'Bren' } as never,
      ],
      messages: [],
      jobs: [],
      partyMembers: [
        { id: 's1', partyId: 'table', userId: 'joueur', works: [], ready, isHost: true, joinedAt: NOW },
      ],
    };
    return { store, characters: new CharacterService(makeOnboardingPrisma(store) as never) };
  }

  it('refuse a un siege pret, et ne touche a rien', async () => {
    const { store, characters } = seated(true);

    await expect(characters.reset(UNIVERSE_ID, 'joueur')).rejects.toBeInstanceOf(LockedError);
    expect(store.characters.map((row) => row.id)).toEqual(['fiche', 'autre']);
  });

  it('efface sa fiche seule quand le siege n est pas pret', async () => {
    const { store, characters } = seated(false);

    await characters.reset(UNIVERSE_ID, 'joueur');
    expect(store.characters.map((row) => row.id)).toEqual(['autre']);
  });
});
