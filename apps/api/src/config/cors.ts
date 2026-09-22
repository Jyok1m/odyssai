import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { AppConfig } from './app-config.js';

/*
  Verbes ouverts au navigateur, et le piege qui va avec : une route servie
  sous un verbe absent d'ici marche depuis curl et depuis supertest, qui
  n'emettent pas de preflight, et echoue dans un navigateur seul.

  Toute route sous un nouveau verbe s'ajoute ici. `cors.e2e-spec.ts` le
  verifie verbe par verbe.
*/
export const CORS_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

/*
  Le front est sur une autre origine et envoie le cookie de session :
  credentials impose une origine nommee, jamais un joker.

  Dans un fichier a part et non dans main.ts : la configuration CORS y serait
  hors du graphe de modules, donc invisible aux tests, ce qui est exactement
  ce qui a laisse passer l'absence de PUT.
*/
export function corsOptions(config: AppConfig): CorsOptions {
  return {
    origin: config.webBaseUrl.origin,
    credentials: true,
    methods: [...CORS_METHODS],
  };
}
