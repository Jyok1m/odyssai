import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { AppConfig } from './../src/config/app-config.js';
import { corsOptions } from './../src/config/cors.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import { makeOnboardingPrisma } from './../src/onboarding/testing/doubles.js';

/**
 * Le preflight, et rien d'autre.
 *
 * supertest appelle l'application sans jamais en emettre un : une route servie
 * sous un verbe absent de la configuration CORS passait donc tous les tests et
 * echouait dans le navigateur seul. C'est ce qui est arrive a PUT /onboarding.
 */
describe('CORS (e2e)', () => {
  let app: INestApplication<App>;
  const origin = 'http://localhost:3000';

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(PRISMA)
      .useValue(
        makeOnboardingPrisma({
          users: [],
          universes: [],
          characters: [],
          messages: [],
          jobs: [],
        }),
      )
      .compile();

    app = moduleFixture.createNestApplication<INestApplication<App>>();
    // La meme configuration que main.ts, prise a la meme source.
    app.enableCors(corsOptions(app.get(AppConfig)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Chaque verbe qu'une route expose. En ajouter un ici sans l'ajouter a
  // CORS_METHODS fait echouer ce test, ce qui est tout l'interet.
  it.each(['GET', 'POST', 'PUT', 'PATCH'])(
    'autorise %s depuis le front',
    async (method) => {
      const response = await request(app.getHttpServer())
        .options('/onboarding')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'content-type');

      expect(response.headers['access-control-allow-methods']).toContain(method);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      // Sans cela le navigateur jette la reponse malgre l'origine autorisee.
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    },
  );

  it('refuse une origine inconnue', async () => {
    const response = await request(app.getHttpServer())
      .options('/onboarding')
      .set('Origin', 'https://evil.test')
      .set('Access-Control-Request-Method', 'PUT');

    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://evil.test',
    );
  });
});
