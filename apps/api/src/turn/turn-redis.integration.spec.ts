import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PENDING_ROLL_TTL_SECONDS } from '@odyssai/schemas';
import type { NarratorConfig } from '../config/narrator-config.js';
import {
  connectLiveRedis,
  dropKeys,
  runId,
  sleep,
} from '../redis/testing/live-redis.js';
import { PendingRollService, pendingRollKey } from './pending-roll.service.js';
import { TurnLimitsService } from './turn-limits.service.js';
import {
  LOCK_TTL_SECONDS,
  RENEW_EVERY_MS,
  TurnLockService,
} from './turn-lock.service.js';

/*
  Les trois services du tour contre un vrai Redis : les scripts Lua, les TTL
  et `getdel` sont ce que le double imite, et c'est ici qu'on verifie qu'il
  imite juste.
*/
const redis = await connectLiveRedis();
const run = runId();

afterAll(async () => {
  if (!redis) return;
  await dropKeys(redis, run);
  await redis.quit();
});

let counter = 0;
function id(label: string): string {
  counter += 1;
  return `${run}-${label}-${counter}`;
}

describe.skipIf(!redis)('verrou de narration, Redis reel', () => {
  const locks = () => new TurnLockService(redis!);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pose le verrou pour son delai entier et le refuse au second', async () => {
    const universe = id('univers');
    const token = await locks().acquire(universe);

    expect(token).not.toBeNull();
    const ttl = await redis!.ttl(`turn:lock:${universe}`);
    expect(ttl).toBeGreaterThan(LOCK_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(LOCK_TTL_SECONDS);
    expect(await locks().acquire(universe)).toBeNull();
  });

  it('renouveler repart pour un delai entier', async () => {
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;
    await redis!.expire(`turn:lock:${universe}`, 5);

    expect(await locks().renew(universe, token)).toBe(true);
    expect(await redis!.ttl(`turn:lock:${universe}`)).toBeGreaterThan(LOCK_TTL_SECONDS - 5);
  });

  it('renouveler apres expiration echoue et ne recree rien', async () => {
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;
    await redis!.pexpire(`turn:lock:${universe}`, 50);
    await sleep(120);

    expect(await locks().renew(universe, token)).toBe(false);
    expect(await redis!.exists(`turn:lock:${universe}`)).toBe(0);
  });

  it('ne prolonge ni ne ferme le verrou repris par un autre tour', async () => {
    const universe = id('univers');
    const first = (await locks().acquire(universe))!;
    await redis!.set(`turn:lock:${universe}`, 'autre-jeton', 'EX', 30);

    expect(await locks().renew(universe, first)).toBe(false);
    expect(await redis!.ttl(`turn:lock:${universe}`)).toBeLessThanOrEqual(30);

    await locks().release(universe, first);
    expect(await redis!.get(`turn:lock:${universe}`)).toBe('autre-jeton');
  });

  it('rend le verrou, qui redevient disponible', async () => {
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;

    await locks().release(universe, token);
    expect(await locks().acquire(universe)).not.toBeNull();
  });

  it('un seul gagnant parmi des tours simultanes', async () => {
    const universe = id('univers');
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => locks().acquire(universe)),
    );
    expect(tokens.filter(Boolean)).toHaveLength(1);
  });

  it('le tour vivant prolonge le verrou en arriere-plan', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;
    await redis!.expire(`turn:lock:${universe}`, 5);

    const lease = locks().keep(universe, token);
    vi.advanceTimersByTime(RENEW_EVERY_MS);
    await vi.waitFor(async () => {
      expect(await redis!.ttl(`turn:lock:${universe}`)).toBeGreaterThan(LOCK_TTL_SECONDS - 5);
    });

    expect(await lease.confirm()).toBe(true);
    lease.stop();
  });

  it('un verrou expire se voit a la confirmation, et le reste', async () => {
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;
    const lease = locks().keep(universe, token);

    await redis!.pexpire(`turn:lock:${universe}`, 50);
    await sleep(120);
    expect(await lease.confirm()).toBe(false);

    // Meme reposee avec le meme jeton, la confirmation ne revient pas.
    await redis!.set(`turn:lock:${universe}`, token, 'EX', 30);
    expect(await lease.confirm()).toBe(false);
    lease.stop();
  });

  it('un renouvellement en erreur se voit a la confirmation', async () => {
    const universe = id('univers');
    const token = (await locks().acquire(universe))!;

    const dead = redis!.duplicate({ enableOfflineQueue: false, lazyConnect: true });
    const lease = new TurnLockService(dead).keep(universe, token);

    expect(await lease.confirm()).toBe(false);
    lease.stop();
    dead.disconnect();
  });
});

describe.skipIf(!redis)('limites du tour, Redis reel', () => {
  const limits = (perHour: number, perDay: number) =>
    new TurnLimitsService(redis!, {
      turnLimits: { perHour, perDay },
    } as unknown as NarratorConfig);

  it('accorde jusqu a la limite horaire, puis refuse avec le delai restant', async () => {
    const service = limits(3, 100);
    const user = id('joueur');

    for (let i = 0; i < 3; i += 1) {
      expect((await service.consume(user)).allowed).toBe(true);
    }
    const refused = await service.consume(user);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(3_600);
  });

  it('compte juste sous la concurrence', async () => {
    const service = limits(5, 100);
    const user = id('joueur');

    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => service.consume(user)),
    );
    expect(verdicts.filter((verdict) => verdict.allowed)).toHaveLength(5);
  });

  it('la limite du jour tient a travers les heures', async () => {
    const service = limits(100, 4);
    const user = id('joueur');
    const start = Date.UTC(2026, 0, 1, 1);

    for (let hour = 0; hour < 4; hour += 1) {
      expect((await service.consume(user, start + hour * 3_600_000)).allowed).toBe(true);
    }
    const refused = await service.consume(user, start + 4 * 3_600_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(3_600);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(86_400);
  });

  it('chaque fenetre expire, et la limite avec elle', async () => {
    const service = limits(1, 100);
    const user = id('joueur');
    const now = Date.now();
    const hourKey = `turn:rl:${user}:h:${Math.floor(now / 3_600_000)}`;
    const dayKey = `turn:rl:${user}:d:${Math.floor(now / 86_400_000)}`;

    expect((await service.consume(user, now)).allowed).toBe(true);
    expect(await redis!.ttl(hourKey)).toBeGreaterThan(3_590);
    expect(await redis!.ttl(dayKey)).toBeGreaterThan(86_390);
    expect((await service.consume(user, now)).allowed).toBe(false);

    await redis!.pexpire(hourKey, 50);
    await sleep(120);
    expect((await service.consume(user, now)).allowed).toBe(true);
  });
});

describe.skipIf(!redis)('action en attente, Redis reel', () => {
  const pending = () => new PendingRollService(redis!);
  const ACTION = {
    content: 'je coupe la branche',
    situation: 'violence' as const,
    locale: 'fr' as const,
  };

  it('garde l action le temps prevu et la rend', async () => {
    const user = id('joueur');
    await pending().hold(user, ACTION);

    const ttl = await redis!.ttl(pendingRollKey(user));
    expect(ttl).toBeGreaterThan(PENDING_ROLL_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(PENDING_ROLL_TTL_SECONDS);
    expect(await pending().take(user)).toEqual(ACTION);
    expect(await redis!.exists(pendingRollKey(user))).toBe(0);
  });

  it('ne se laisse prendre qu une fois, meme en rafale', async () => {
    const user = id('joueur');
    await pending().hold(user, ACTION);

    const taken = await Promise.all(Array.from({ length: 10 }, () => pending().take(user)));
    expect(taken.filter(Boolean)).toHaveLength(1);
  });

  it('une action expiree ne se prend plus', async () => {
    const user = id('joueur');
    await pending().hold(user, ACTION);
    await redis!.pexpire(pendingRollKey(user), 50);
    await sleep(120);

    expect(await pending().take(user)).toBeNull();
  });

  it('une action illisible se consomme sans rien rendre', async () => {
    const user = id('joueur');
    await redis!.set(pendingRollKey(user), '{pas du json', 'EX', 30);

    expect(await pending().take(user)).toBeNull();
    expect(await redis!.exists(pendingRollKey(user))).toBe(0);
  });

  it('les attentes d une table tombent ensemble, pas celles des autres', async () => {
    const [a, b, outsider] = [id('joueur'), id('joueur'), id('joueur')];
    await Promise.all([a, b, outsider].map((user) => pending().hold(user, ACTION)));

    await pending().dropAll([a, b]);
    expect(await pending().take(a)).toBeNull();
    expect(await pending().take(b)).toBeNull();
    expect(await pending().take(outsider)).toEqual(ACTION);
  });
});
