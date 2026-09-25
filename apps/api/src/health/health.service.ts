import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';

/*
  Une sonde qui pend est pire qu'une sonde qui echoue : docker la coupe a son
  propre delai et rend le conteneur sain jusque la. Deux secondes suffisent a
  un aller-retour local, et au dela il n'y a plus rien a attendre.
*/
const PROBE_TIMEOUT_MS = 2_000;

export type ProbeState = 'up' | 'down';

export interface Readiness {
  status: 'ok' | 'degraded';
  checks: { redis: ProbeState; postgres: ProbeState };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /*
    Les deux sondes partent ensemble : en serie, un Redis injoignable qui va
    au bout de son delai retarderait celle de Postgres, et la reponse pourrait
    depasser le delai de docker alors que chaque sonde tient le sien.
  */
  async ready(): Promise<Readiness> {
    const [redis, postgres] = await Promise.all([
      this.probe('redis', () => this.redis.ping()),
      this.probe('postgres', () => this.prisma.$queryRaw`SELECT 1`),
    ]);

    return {
      status: redis === 'up' && postgres === 'up' ? 'ok' : 'degraded',
      checks: { redis, postgres },
    };
  }

  /*
    La raison de l'echec part au journal et jamais dans la reponse : une sonde
    ouverte sans session n'a pas a decrire l'infrastructure a qui la lit.
  */
  private async probe(
    name: string,
    run: () => PromiseLike<unknown>,
  ): Promise<ProbeState> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`sonde ${name} expiree`)),
        PROBE_TIMEOUT_MS,
      ).unref(),
    );

    try {
      await Promise.race([run(), timeout]);
      return 'up';
    } catch (error: unknown) {
      this.logger.warn(`sonde ${name} en echec : ${String(error)}`);
      return 'down';
    }
  }
}
