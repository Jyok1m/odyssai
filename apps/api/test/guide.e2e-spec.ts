import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideStreamEvent } from '@odyssai/schemas';
import { AppModule } from './../src/app.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { GenerationQueueService } from './../src/onboarding/generation-queue.service.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { GuideFaqService } from './../src/guide/guide-faq.service.js';
import { GUIDE_LLM } from './../src/guide/guide-llm.provider.js';
import {
  GuideFakeRedis,
  makeFakeLlm,
  makeFaqEntry,
  type FakeLlm,
} from './../src/guide/testing/doubles.js';

const PASS_COOKIE = 'odyssai_guide_pass';
const FAQ_QUESTION = 'Une question de FAQ ?';

interface Harness {
  app: INestApplication<App>;
  llm: FakeLlm;
  redis: GuideFakeRedis;
  journal: { create: ReturnType<typeof vi.fn> };
}

// Journal reduit a ce que GuideJournalService appelle.
function makePrisma() {
  const create = vi.fn(async () => ({}));
  return {
    double: {
      guideQuestion: { create, deleteMany: vi.fn(async () => ({ count: 0 })) },
      $disconnect: vi.fn(async () => {}),
    },
    create,
  };
}

// FAQ de test : une seule entree validee, pour que le chemin gratuit existe.
const fakeFaq = {
  find: (_locale: string, question: string) =>
    question.trim() === FAQ_QUESTION ? makeFaqEntry() : undefined,
  suggestions: () => [{ id: 'entree-test', question: FAQ_QUESTION }],
  onModuleInit: () => {},
};

async function boot(
  env: Record<string, string> = {},
  llm: FakeLlm = makeFakeLlm(),
): Promise<Harness> {
  const previous = { ...process.env };
  Object.assign(process.env, env);

  const redis = new GuideFakeRedis();
  const prisma = makePrisma();

  try {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(PRISMA)
      .useValue(prisma.double)
      .overrideProvider(GUIDE_LLM)
      .useValue(llm)
      .overrideProvider(GuideFaqService)
      .useValue(fakeFaq)
      .overrideProvider(GenerationQueueService)
      .useValue({ enqueue: async () => {}, onApplicationShutdown: async () => {} })
      .compile();

    const app = moduleFixture.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    await app.init();

    return { app, llm, redis, journal: { create: prisma.create } };
  } finally {
    process.env = previous;
  }
}

function events(body: string): GuideStreamEvent[] {
  return body
    .split('\n\n')
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as GuideStreamEvent);
}

// Un pass valide, sans jamais joindre Cloudflare.
async function getPass(app: INestApplication<App>): Promise<string> {
  const siteverify = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

  try {
    const response = await request(app.getHttpServer())
      .post('/guide/pass')
      .send({ turnstileToken: 'jeton-de-test' })
      .expect(204);

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find(
      (value) => value.startsWith(PASS_COOKIE),
    );
    return cookie!.split(';')[0]!;
  } finally {
    siteverify.mockRestore();
  }
}

describe('Guide (e2e)', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.app.close();
    vi.restoreAllMocks();
  });

  describe('suggestions', () => {
    beforeEach(async () => {
      harness = await boot();
    });

    it('les sert sans pass et les laisse mettre en cache', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/guide/suggestions?locale=fr')
        .expect(200);

      expect(response.body).toEqual({
        suggestions: [{ id: 'entree-test', question: FAQ_QUESTION }],
      });
      expect(response.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  describe('ask', () => {
    beforeEach(async () => {
      harness = await boot();
    });

    it('repond une question de FAQ sans pass ni appel au modele', async () => {
      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .send({ question: FAQ_QUESTION, locale: 'fr' })
        .expect(200);

      expect(events(response.text)).toEqual([
        { type: 'meta', source: 'faq' },
        { type: 'delta', text: 'Une reponse de FAQ validee.' },
        { type: 'done' },
      ]);
      expect(harness.llm.calls).toHaveLength(0);
      expect(harness.journal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'faq', faqEntryId: 'entree-test' }),
        }),
      );
    });

    it('refuse une question sans pass', async () => {
      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .send({ question: 'Une question hors FAQ ?', locale: 'fr' })
        .expect(403);

      expect(response.body).toEqual({ code: 'pass_required' });
      expect(harness.llm.calls).toHaveLength(0);
    });

    it('refuse un corps invalide', async () => {
      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .send({ question: '   ', locale: 'fr' })
        .expect(400);

      expect(response.body).toEqual({ code: 'validation_error' });
    });

    it('stream une reponse du modele apres le pass', async () => {
      const cookie = await getPass(harness.app);

      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .set('Cookie', cookie)
        .send({ question: 'Une question hors FAQ ?', locale: 'fr' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(events(response.text)).toEqual([
        { type: 'meta', source: 'llm' },
        { type: 'delta', text: 'Une reponse de test.' },
        { type: 'done' },
      ]);
      expect(harness.llm.calls).toHaveLength(1);
    });
  });

  describe('hors sujet', () => {
    it('sert le texte generique sans laisser passer un delta du modele', async () => {
      harness = await boot({}, makeFakeLlm({ chunks: ['[[HORS', '_SUJET]]'] }));
      const cookie = await getPass(harness.app);

      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .set('Cookie', cookie)
        .send({ question: 'Donne-moi une recette de crepes', locale: 'fr' })
        .expect(200);

      const received = events(response.text);
      expect(received[0]).toEqual({ type: 'meta', source: 'off_topic' });
      expect(received[1]!.type).toBe('delta');
      expect((received[1] as { text: string }).text).toContain(
        "Je suis le guide d'OdyssAI",
      );
      expect(received[2]).toEqual({ type: 'done' });

      // Aucun fragment de la sentinelle n'a fuite vers le visiteur.
      expect(response.text).not.toContain('HORS_SUJET');
      expect(harness.llm.aborted).toBe(true);
    });
  });

  describe('garde-fous', () => {
    it('renvoie 429 et Retry-After quand la limite horaire est depassee', async () => {
      harness = await boot({ GUIDE_RATE_PER_HOUR: '1' });
      const cookie = await getPass(harness.app);
      const ask = () =>
        request(harness.app.getHttpServer())
          .post('/guide/ask')
          .set('Cookie', cookie)
          .send({ question: 'Une question hors FAQ ?', locale: 'fr' });

      await ask().expect(200);
      const refus = await ask().expect(429);

      expect(refus.body.code).toBe('rate_limited');
      expect(refus.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(refus.headers['retry-after']).toBeDefined();
    });

    it('sert la reponse degradee quand le budget est a zero, sans appeler le modele', async () => {
      harness = await boot({ GUIDE_DAILY_BUDGET_USD: '0' });
      const cookie = await getPass(harness.app);

      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .set('Cookie', cookie)
        .send({ question: 'Une question hors FAQ ?', locale: 'fr' })
        .expect(200);

      const received = events(response.text);
      expect(received[0]).toEqual({ type: 'meta', source: 'degraded' });
      expect((received[1] as { text: string }).text).toContain('limite pour');
      expect(harness.llm.calls).toHaveLength(0);
      expect(harness.redis.inflight()).toBe(0);
    });

    it('sert la reponse degradee quand le guide est coupe', async () => {
      harness = await boot({ GUIDE_ENABLED: 'false' });

      const response = await request(harness.app.getHttpServer())
        .post('/guide/ask')
        .send({ question: 'Une question hors FAQ ?', locale: 'fr' })
        .expect(200);

      expect(events(response.text)[0]).toEqual({ type: 'meta', source: 'degraded' });
      expect(harness.llm.calls).toHaveLength(0);
    });
  });

  describe('abandon du visiteur', () => {
    it('coupe la generation amont et libere le creneau', async () => {
      // Un flux qui traine, pour avoir le temps de raccrocher au milieu.
      const slow = makeFakeLlm({ chunks: ['debut ', 'suite ', 'fin'] });
      const original = slow.streamChat.bind(slow);
      slow.streamChat = async function* (req) {
        for await (const event of original(req)) {
          yield event;
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      };

      harness = await boot({}, slow);
      const server = harness.app.getHttpServer() as unknown as Server;
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      const cookie = await getPass(harness.app);
      const controller = new AbortController();

      const response = await fetch(`http://127.0.0.1:${port}/guide/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ question: 'Une question hors FAQ ?', locale: 'fr' }),
        signal: controller.signal,
      });

      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => {});

      // Le serveur voit la fermeture, coupe l'amont et rend le creneau.
      await vi.waitFor(() => {
        expect(slow.aborted).toBe(true);
        expect(harness.redis.inflight()).toBe(0);
      });
    });
  });
});
