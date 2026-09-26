import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeRedis } from '../auth/testing/doubles.js';
import { TurnLockService } from './turn-lock.service.js';

function service() {
  return new TurnLockService(new FakeRedis() as unknown as Redis);
}

/*
  Une narration a la fois par histoire : le verrou qui tient la regle. Le
  joueur qui arrive pendant que le meneur raconte repond `busy`, et celui qui
  raconte rend son creneau quoi qu'il arrive.
*/
describe('verrou de narration', () => {
  it('accorde le creneau au premier et le refuse au second', async () => {
    const locks = service();

    const first = await locks.acquire('univers');
    expect(first).not.toBeNull();

    expect(await locks.acquire('univers')).toBeNull();
  });

  it('rend le creneau, qui redevient disponible', async () => {
    const locks = service();
    const token = await locks.acquire('univers');

    await locks.release('univers', token!);
    expect(await locks.acquire('univers')).not.toBeNull();
  });

  /*
    Le point qui compte : un verrou expire et un autre tour le reprend, la
    main du premier ne doit pas fermer celui du second. Le jeton fait la
    difference.
  */
  it('ne ferme pas le verrou d un autre tour', async () => {
    const locks = service();
    const first = (await locks.acquire('univers'))!;

    // Le creneau expire, un second tour le prend.
    const client = new FakeRedis() as unknown as Redis;
    await client.set('turn:lock:univers', 'autre-jeton', 'EX', 180);

    await locks.release('univers', first);
    expect(await client.get('turn:lock:univers')).toBe('autre-jeton');
  });

  it('deux histories, deux creneaux', async () => {
    const locks = service();

    expect(await locks.acquire('univers-a')).not.toBeNull();
    expect(await locks.acquire('univers-b')).not.toBeNull();
    expect(await locks.acquire('univers-a')).toBeNull();
  });
});
