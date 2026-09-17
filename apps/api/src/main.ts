import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { corsOptions } from './config/cors.js';
import { GuideConfig } from './config/guide-config.js';
import { loadRootEnvFile } from '@odyssai/db';

async function bootstrap() {
  loadRootEnvFile();

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  const guideConfig = app.get(GuideConfig);

  app.use(cookieParser());

  // Mal regle, req.ip vaut l'adresse du proxy et la limite par IP du guide
  // devient une limite globale.
  app.getHttpAdapter().getInstance().set('trust proxy', guideConfig.trustProxy);

  app.enableCors(corsOptions(config));

  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap KC').log(`Realm KC up : ${config.keycloak.issuer}`);
  new Logger('Bootstrap API').log(`API sur ${config.apiBaseUrl.origin}`);
  new Logger('Bootstrap Web').log(`Web sur ${config.webBaseUrl.origin}`);
}

await bootstrap();
