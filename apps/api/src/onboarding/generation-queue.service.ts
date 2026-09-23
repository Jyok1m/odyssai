import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { GENERATION_QUEUE, type GenerationJobData } from '@odyssai/schemas';
import { AppConfig } from '../config/app-config.js';
import { REDIS } from '../redis/redis.module.js';

/*
  Publie le travail de generation. Le worker le consomme, l'api ne fait que
  l'annoncer : elle n'attend rien et ne sait rien de son deroulement autrement
  que par la table generation_jobs.
*/
@Injectable()
export class GenerationQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(GenerationQueueService.name);
  private readonly queue: Queue<GenerationJobData>;

  constructor(@Inject(REDIS) redis: Redis, config: AppConfig) {
    // Une connexion dupliquee, et non celle des sessions : BullMQ met ses
    // consommateurs en mode bloquant, ce qui rendrait la connexion partagee
    // inutilisable pour tout le reste.
    this.queue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
      prefix: config.queuePrefix,
      connection: redis.duplicate({ maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        /*
          Redis transporte, Postgres enregistre : rien ne justifie de retenir
          un travail fini, et le garder empecherait une relance, l'identifiant
          du travail etant celui de l'univers.
        */
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }

  /*
    L'identifiant du travail est celui de l'univers : deux requetes du meme
    joueur arrivees ensemble ne lancent qu'une generation, BullMQ refusant un
    doublon. La base ne peut pas garantir cela seule, rien n'y empechant deux
    lectures concurrentes de voir la meme etape.
  */
  async enqueue(universeId: string): Promise<void> {
    try {
      await this.queue.add('generate', { universeId }, { jobId: universeId });
    } catch (error: unknown) {
      // La ligne generation_jobs existe deja : le travail est enregistre, il
      // suffira de le republier. Faire echouer la reponse ferait croire au
      // joueur que sa fiche n'a pas ete enregistree.
      this.logger.error(`mise en file impossible : ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
