import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';

/**
 * Charge le .env de la racine du monorepo.
 *
 * Chaque application demarre dans son propre repertoire, on remonte donc
 * jusqu'a trouver le fichier. Les variables deja presentes dans
 * l'environnement gagnent : en production il n'y a pas de fichier et rien
 * n'ecrase ce que fournit l'orchestrateur.
 */
function loadRootEnvFile(): void {
  let directory = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }

    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

async function bootstrap() {
  loadRootEnvFile();

  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);

  app.use(cookieParser());

  // Le front est sur une autre origine et doit pouvoir envoyer le cookie de
  // session : credentials impose une origine nommee, jamais un joker.
  app.enableCors({
    origin: config.webBaseUrl.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  // Ferme proprement la connexion Redis a l'arret du conteneur.
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap API').log(`API sur ${config.apiBaseUrl.origin}`);
  new Logger('Bootstrap Web').log(`Web sur ${config.webBaseUrl.origin}`);
  new Logger('Bootstrap KC').log(`Realm KC up : ${config.keycloak.issuer}`);
}

await bootstrap();
