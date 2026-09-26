import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  RedisUnavailableError,
  RedisUnavailableFilter,
  isRedisUnavailable,
} from './redis-unavailable.js';

class MaxRetriesPerRequestError extends Error {
  override get name() {
    return 'MaxRetriesPerRequestError';
  }
}

@Controller()
class ProbeController {
  @Get('retries')
  retries() {
    throw new MaxRetriesPerRequestError('Reached the max retries per request limit (which is 3).');
  }

  @Get('closed')
  async closed() {
    throw new Error('Connection is closed.');
  }

  @Get('offline')
  offline() {
    throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
  }

  @Get('timeout')
  timeout() {
    throw new RedisUnavailableError('file de generation injoignable');
  }

  @Get('bad')
  bad() {
    throw new BadRequestException({ code: 'validation_error' });
  }

  @Get('boom')
  boom() {
    throw new Error('autre chose');
  }
}

describe('Redis injoignable', () => {
  it('reconnait les erreurs de connexion ioredis, et elles seules', () => {
    expect(isRedisUnavailable(new MaxRetriesPerRequestError('x'))).toBe(true);
    expect(isRedisUnavailable(new Error('Connection is closed.'))).toBe(true);
    expect(isRedisUnavailable(new RedisUnavailableError('x'))).toBe(true);
    expect(isRedisUnavailable(new Error('ERR wrong number of arguments'))).toBe(false);
    expect(isRedisUnavailable('Connection is closed.')).toBe(false);
  });
});

describe('filtre 503', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: RedisUnavailableFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['retries', 'closed', 'offline', 'timeout'])('%s repond 503', async (path) => {
    const response = await request(app.getHttpServer()).get(`/${path}`);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('unavailable');
    // Le message d'ioredis reste au journal.
    expect(JSON.stringify(response.body)).not.toMatch(/ioredis|Connection|retries/);
  });

  it('laisse passer une erreur HTTP telle quelle', async () => {
    const response = await request(app.getHttpServer()).get('/bad');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_error');
  });

  it('laisse une autre erreur en 500', async () => {
    const response = await request(app.getHttpServer()).get('/boom');
    expect(response.status).toBe(500);
  });
});
