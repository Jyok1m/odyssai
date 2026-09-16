import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resout les alias de chemin declares dans tsconfig.json.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Charge avant tout import applicatif : le tracing doit etre coupe avant
    // qu'un module ne lise l'environnement.
    setupFiles: ['./test/setup-unit.ts'],
  },
});
