import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { AppConfig } from './app-config.js';

/**
 * Verbes ouverts au navigateur.
 *
 * La liste est explicite plutot que laissee au defaut de `cors`, mais c'est un
 * piege : une route servie sous un verbe absent d'ici marche depuis curl et
 * depuis les tests, et echoue seulement dans un navigateur, ou le preflight la
 * refuse. PUT y a manque le temps que le parcours d'entree en jeu sorte.
 *
 * Toute route ajoutee sous un nouveau verbe s'ajoute ici, et le controle du
 * preflight dans les tests e2e le rappelle.
 */
export const CORS_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

/**
 * Le front est sur une autre origine et envoie le cookie de session :
 * credentials impose une origine nommee, jamais un joker.
 *
 * Dans un fichier a part et non dans main.ts : la configuration CORS y serait
 * hors du graphe de modules, donc invisible aux tests, ce qui est exactement
 * ce qui a laisse passer l'absence de PUT.
 */
export function corsOptions(config: AppConfig): CorsOptions {
  return {
    origin: config.webBaseUrl.origin,
    credentials: true,
    methods: [...CORS_METHODS],
  };
}
