import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
  Charge le .env de la racine du monorepo en remontant depuis `from`, chaque
  application demarrant dans son propre repertoire. L'environnement deja en
  place gagne : en production il n'y a pas de fichier et rien n'ecrase ce que
  fournit l'orchestrateur.
*/
export function loadRootEnvFile(from: string = process.cwd()): void {
  let directory = from;

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
