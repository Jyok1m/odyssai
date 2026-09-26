import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

/*
  Le Redis de la base de dev, pour les tests d'integration. Les scripts Lua,
  les TTL et l'atomicite ne se prouvent pas sur un double.
*/
export const LIVE_REDIS_URL = process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:16379/0';

/*
  Le client, ou rien si Redis ne repond pas. La CI n'a pas de Redis et saute
  ces suites ; ailleurs, un Redis absent fait echouer au lieu de passer sous
  silence ce qui n'a pas ete teste.
*/
export async function connectLiveRedis(): Promise<Redis | null> {
  const client = new Redis(LIVE_REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return client;
  } catch {
    client.disconnect();
    if (process.env.CI === 'true') return null;
    throw new Error(`Redis injoignable sur ${LIVE_REDIS_URL} : ouvrir le tunnel ou poser REDIS_TEST_URL`);
  }
}

// Un espace de cles propre a l'execution : rien d'autre n'est lu ni efface.
export function runId(): string {
  return `it-${randomUUID()}`;
}

export async function dropKeys(redis: Redis, run: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `*${run}*`, 'COUNT', 500);
    if (keys.length > 0) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
