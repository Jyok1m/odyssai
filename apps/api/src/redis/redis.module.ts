import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';
import { RedisUnavailableFilter } from './redis-unavailable.js';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.redisUrl, {
          // Echouer vite plutot que faire patienter la requete du joueur.
          maxRetriesPerRequest: 3,
          connectTimeout: 5_000,
          enableReadyCheck: true,
        });
        client.on('error', (error: Error) => logger.error(error.message));
        return client;
      },
    },
    { provide: APP_FILTER, useClass: RedisUnavailableFilter },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
