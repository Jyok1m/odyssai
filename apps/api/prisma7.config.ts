import { defineConfig } from 'prisma/config';
import { loadRootEnvFile } from './src/config/root-env.js';

// Le CLI Prisma 7 ne charge plus aucun .env : on reprend le chargement de
// l'API, depuis le repertoire de ce fichier et non le repertoire de travail.
loadRootEnvFile(import.meta.dirname);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Lue par migrate, db et studio. A l'execution, PrismaModule lit la meme
  // variable via son adaptateur pg.
  datasource: {
    url: process.env.POSTGRES_URL,
  },
});
