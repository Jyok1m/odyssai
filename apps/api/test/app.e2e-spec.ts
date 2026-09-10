import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import { AppModule } from './../src/app.module.js';
import { REDIS } from './../src/redis/redis.module.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Aucun service d'infrastructure n'est requis pour ces cas : la session
      // vit dans un double en memoire.
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });

  it('/auth/session (GET) sans cookie', () => {
    return request(app.getHttpServer())
      .get('/auth/session')
      .expect(200)
      .expect({ authenticated: false });
  });

  it('/auth/session (GET) avec un cookie inconnu', () => {
    return request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', 'odyssai_session=identifiant-invente')
      .expect(200)
      .expect({ authenticated: false });
  });

  it('/auth/signin (GET) refuse une redirection externe', () => {
    return request(app.getHttpServer())
      .get('/auth/signin')
      .query({ redirect: 'https://evil.test/phishing' })
      .expect(400);
  });

  it('/auth/signout (POST) sans session renvoie le site public', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signout').expect(200);

    expect(response.body).toEqual({ logoutUrl: 'http://localhost:3000/' });
  });

  afterEach(async () => {
    await app.close();
  });
});
