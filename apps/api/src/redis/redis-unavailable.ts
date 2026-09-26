import {
  type ArgumentsHost,
  Catch,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Ce que l'api leve elle-meme quand Redis ne repond pas dans les temps.
export class RedisUnavailableError extends Error {
  override readonly name = 'RedisUnavailableError';
}

/*
  Les formes sous lesquelles ioredis dit qu'il n'y a plus personne en face.
  Lues au nom et au message : ses classes d'erreur ne sont pas exportees
  par l'entree du paquet.
*/
const UNAVAILABLE_MESSAGES = new Set([
  'Connection is closed.',
  "Stream isn't writeable and enableOfflineQueue options is false",
]);

export function isRedisUnavailable(error: unknown): boolean {
  if (error instanceof RedisUnavailableError) return true;
  if (!(error instanceof Error)) return false;
  return error.name === 'MaxRetriesPerRequestError' || UNAVAILABLE_MESSAGES.has(error.message);
}

/*
  Un Redis injoignable repond 503 et non 500 : le service est indisponible,
  pas en faute, et le client peut reessayer. Tout le reste suit le
  traitement par defaut de Nest.
*/
@Catch()
export class RedisUnavailableFilter extends BaseExceptionFilter {
  private readonly log = new Logger('Redis');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (!isRedisUnavailable(exception)) {
      super.catch(exception, host);
      return;
    }
    this.log.error(`redis injoignable : ${(exception as Error).message}`);
    super.catch(new ServiceUnavailableException({ code: 'unavailable' }), host);
  }
}
