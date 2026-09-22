import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeRedis } from '../auth/testing/doubles.js';
import { PendingRollService } from './pending-roll.service.js';

const ACTION = {
  content: 'je coupe la branche',
  situation: 'violence' as const,
  locale: 'fr' as const,
};

function service() {
  return new PendingRollService(new FakeRedis() as unknown as Redis);
}

describe('action en attente de son jet', () => {
  it('rend ce qui a ete mis en attente', async () => {
    const pending = service();
    await pending.hold('joueur', ACTION);
    expect(await pending.take('joueur')).toEqual(ACTION);
  });

  /*
    Le point qui compte : deux clics sur le bouton ne doivent pas jouer le
    tour deux fois. C'est `getdel` qui tranche cote Redis, une lecture suivie
    d'une suppression laisserait passer deux appels concurrents.
  */
  it('ne se laisse prendre qu une fois', async () => {
    const pending = service();
    await pending.hold('joueur', ACTION);

    const [first, second] = await Promise.all([
      pending.take('joueur'),
      pending.take('joueur'),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('ne rend rien quand rien n attend', async () => {
    expect(await service().take('joueur')).toBeNull();
  });

  // Chacun son attente : le jet d'un joueur ne joue pas l'action d'un autre.
  it('ne melange pas deux joueurs', async () => {
    const pending = service();
    await pending.hold('un', ACTION);
    expect(await pending.take('deux')).toBeNull();
    expect(await pending.take('un')).toEqual(ACTION);
  });

  // Le joueur repart sur autre chose : ce qui attendait n'a plus lieu d'etre.
  it('oublie une action abandonnee', async () => {
    const pending = service();
    await pending.hold('joueur', ACTION);
    await pending.drop('joueur');
    expect(await pending.take('joueur')).toBeNull();
  });
});
