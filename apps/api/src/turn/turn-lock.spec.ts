import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeRedis } from '../auth/testing/doubles.js';
import { LOCK_TTL_SECONDS, RENEW_EVERY_MS, TurnLockService } from './turn-lock.service.js';

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

/*
  Un tour enchaine replique, recit, lore et marque, et peut depasser le
  delai du verrou. Le tour vivant le prolonge ; un processus mort le laisse
  expirer.
*/
describe('prolongation du verrou', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prolonge le sien, jamais celui d un autre', async () => {
    const redis = new FakeRedis() as unknown as Redis;
    const locks = new TurnLockService(redis);
    const token = (await locks.acquire('univers'))!;

    expect(await locks.renew('univers', token)).toBe(true);
    expect(await locks.renew('univers', 'autre-jeton')).toBe(false);
    expect(await redis.get('turn:lock:univers')).toBe(token);
  });

  it('tient le verrou au dela de son delai tant que le tour court', async () => {
    vi.useFakeTimers();
    const redis = new FakeRedis() as unknown as Redis;
    const locks = new TurnLockService(redis);
    const token = (await locks.acquire('univers'))!;

    const lease = locks.keep('univers', token);
    await vi.advanceTimersByTimeAsync(LOCK_TTL_SECONDS * 3 * 1000);
    expect(await redis.get('turn:lock:univers')).toBe(token);
    expect(await locks.acquire('univers')).toBeNull();
    expect(await lease.confirm()).toBe(true);

    // Le tour s'arrete sans rendre la main : le verrou finit par expirer seul.
    lease.stop();
    await vi.advanceTimersByTimeAsync((LOCK_TTL_SECONDS + 1) * 1000);
    expect(await redis.get('turn:lock:univers')).toBeNull();
  });

  it('sans prolongation, le verrou expire a son delai', async () => {
    vi.useFakeTimers();
    const redis = new FakeRedis() as unknown as Redis;
    const locks = new TurnLockService(redis);
    await locks.acquire('univers');

    await vi.advanceTimersByTimeAsync((LOCK_TTL_SECONDS + 1) * 1000);
    expect(await locks.acquire('univers')).not.toBeNull();
  });
});

/*
  Un tour qui a perdu son verrou ne doit plus ecrire : `confirm` le dit au
  controleur avant l'ecriture finale, et un renouvellement rate le dit pour
  toute la suite du tour.
*/
describe('verrou perdu en route', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('confirme faux quand un autre tour a pris le verrou', async () => {
    const redis = new FakeRedis() as unknown as Redis;
    const locks = new TurnLockService(redis);
    const token = (await locks.acquire('univers'))!;
    const lease = locks.keep('univers', token);

    await redis.set('turn:lock:univers', 'autre-jeton', 'EX', LOCK_TTL_SECONDS);
    expect(await lease.confirm()).toBe(false);
    lease.stop();
  });

  it('confirme faux quand le renouvellement echoue', async () => {
    const redis = new FakeRedis();
    const locks = new TurnLockService(redis as unknown as Redis);
    const token = (await locks.acquire('univers'))!;
    const lease = locks.keep('univers', token);

    redis.eval = () => Promise.reject(new Error('Connection is closed.'));
    expect(await lease.confirm()).toBe(false);
    lease.stop();
  });

  it('reste perdu apres un renouvellement manque en arriere-plan', async () => {
    vi.useFakeTimers();
    const redis = new FakeRedis();
    const locks = new TurnLockService(redis as unknown as Redis);
    const token = (await locks.acquire('univers'))!;
    const lease = locks.keep('univers', token);

    const evalOriginal = redis.eval.bind(redis);
    redis.eval = () => Promise.reject(new Error('Connection is closed.'));
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);

    // Redis revient et le verrou est toujours la : trop tard, un autre a pu passer.
    redis.eval = evalOriginal;
    expect(await redis.get('turn:lock:univers')).toBe(token);
    expect(await lease.confirm()).toBe(false);
    lease.stop();
  });
});
