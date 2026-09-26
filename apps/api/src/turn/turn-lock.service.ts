import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

/*
  Libere le verrou seulement s'il est encore le sien. Le jeton pose a
  l'entree fait la difference : un verrou expire entre-temps et repris par
  un autre tour ne se ferme pas par la main du premier.
*/
export const RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/*
  Combien de temps une narration peut durer. Au dela, le verrou expire de
  lui-meme : un processus mort ne bloque pas la table indefiniment, et un tour
  qui trainerait trois minutes est de toute facon un tour perdu.
*/
const LOCK_TTL_SECONDS = 180;

/*
  Une narration a la fois par histoire.

  Le meneur ne raconte qu'une scene a la fois, et le journal n'a qu'un rang
  suivant : deux tours simultanes sur la meme histoire se marcheraient
  dessus, celui qui perd ecrirait un message en double ou echouerait sur
  l'unicite du rang. Le solo avait deja la course avec deux onglets, la
  partie l'a avec des joueurs : le verrou la ferme pour tous les deux.

  En Redis et non en base : c'est un creneau de quelques secondes, pas un
  etat de la partie. Il expire seul, rien ne le relit apres coup.
*/
@Injectable()
export class TurnLockService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(universeId: string): string {
    return `turn:lock:${universeId}`;
  }

  // Rend le jeton du vainqueur, ou rien si une narration est deja en cours.
  async acquire(universeId: string): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.set(
      this.key(universeId),
      token,
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    return ok === 'OK' ? token : null;
  }

  async release(universeId: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK, 1, this.key(universeId), token);
  }
}
