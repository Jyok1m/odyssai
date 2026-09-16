import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { loadRootEnvFile } from './config/root-env.js';

async function bootstrap() {
  loadRootEnvFile();

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);

  app.use(cookieParser());

  // Le front est sur une autre origine et envoie le cookie de session :
  // credentials impose une origine nommee, jamais un joker.
  app.enableCors({
    origin: config.webBaseUrl.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap KC').log(`Realm KC up : ${config.keycloak.issuer}`);
  new Logger('Bootstrap API').log(`API sur ${config.apiBaseUrl.origin}`);
  new Logger('Bootstrap Web').log(`Web sur ${config.webBaseUrl.origin}`);
}

await bootstrap();
