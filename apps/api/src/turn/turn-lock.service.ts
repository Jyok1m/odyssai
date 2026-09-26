import { Inject, Injectable, Logger } from '@nestjs/common';
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

// Prolonge le verrou seulement s'il est encore le sien, pour la meme raison.
export const EXTEND_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
`;

/*
  Combien de temps un verrou survit a un processus mort : au dela, il expire
  de lui-meme, et la table ne reste pas bloquee.

  Ce n'est plus la duree d'un tour. Un tour enchaine la replique, le recit,
  un fragment de lore par nom nouveau et la marque, et pouvait depasser un
  delai fixe : le verrou tombait, un second tour prenait le rang suivant, et
  l'ecriture finale du premier echouait apres que le recit avait ete servi.
  Le tour vivant le prolonge donc tant qu'il court.
*/
export const LOCK_TTL_SECONDS = 180;

// Assez souvent pour que deux renouvellements manques ne suffisent pas a le perdre.
export const RENEW_EVERY_MS = (LOCK_TTL_SECONDS / 3) * 1000;

/*
  Le verrou tenu par un tour vivant. `confirm` se demande juste avant
  l'ecriture finale : un tour qui a perdu son verrou en route ne doit plus
  rien ecrire, un autre ayant pu prendre le rang suivant.
*/
export interface TurnLease {
  confirm(): Promise<boolean>;
  stop(): void;
}

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
  private readonly logger = new Logger(TurnLockService.name);

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

  // Vrai si le verrou etait encore le sien et repart pour un delai entier.
  async renew(universeId: string, token: string): Promise<boolean> {
    const extended = await this.redis.eval(
      EXTEND_LOCK,
      1,
      this.key(universeId),
      token,
      String(LOCK_TTL_SECONDS),
    );
    return extended === 1;
  }

  /*
    Tient le verrou tant que le tour court. Un renouvellement rate, refuse ou
    en erreur, le donne pour perdu et le reste : on ne sait plus si un autre
    tour l'a pris entre-temps, et `confirm` repond faux jusqu'au bout.
  */
  keep(universeId: string, token: string): TurnLease {
    let lost = false;

    const check = async (): Promise<boolean> => {
      if (lost) return false;
      try {
        if (await this.renew(universeId, token)) return true;
        this.logger.warn(`verrou de narration perdu : ${universeId}`);
      } catch (error: unknown) {
        this.logger.warn(`verrou de narration non prolonge : ${String(error)}`);
      }
      lost = true;
      return false;
    };

    const timer = setInterval(() => void check(), RENEW_EVERY_MS);
    timer.unref();

    return {
      confirm: check,
      stop: () => clearInterval(timer),
    };
  }
}
