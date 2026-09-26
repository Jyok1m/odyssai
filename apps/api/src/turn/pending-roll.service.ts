import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PENDING_ROLL_TTL_SECONDS, type Situation, type UiLocale } from '@odyssai/schemas';
import { REDIS } from '../redis/redis.module.js';

/*
  Ce qu'une action attend pendant que le joueur lance le de.

  En Redis et non en base : c'est un etat de quelques secondes, propre a une
  session, qui n'a rien a faire dans l'historique d'une partie. Rien n'est
  encore ecrit dans `conversation_messages` a ce moment-la, donc une action
  abandonnee ne laisse pas un message sans reponse.

  Et surtout, rien de tout cela ne repasse par le navigateur entre les deux
  temps : le texte du joueur, sa langue et sa situation sont des decisions
  deja prises, que le client pourrait sinon rejouer autrement.
*/
export interface PendingRoll {
  content: string;
  situation: Situation;
  locale: UiLocale;
}

/*
  La cle d'une action en attente. Exportee pour le depart d'une table : la
  partie qui s'en va laisse ce qu'elle attendait, sans que le module de
  partie ait besoin du module de tour (et de tout ce qu'il importe).
*/
export function pendingRollKey(userId: string): string {
  return `turn:pending:${userId}`;
}

@Injectable()
export class PendingRollService {
  private readonly logger = new Logger(PendingRollService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(userId: string): string {
    return pendingRollKey(userId);
  }

  async hold(userId: string, pending: PendingRoll): Promise<void> {
    await this.redis.set(
      this.key(userId),
      JSON.stringify(pending),
      'EX',
      PENDING_ROLL_TTL_SECONDS,
    );
  }

  /*
    Lit et efface d'un seul coup : deux clics sur le bouton ne doivent pas
    jouer le tour deux fois, et `getdel` tranche cote Redis plutot que par une
    lecture suivie d'une suppression, ou deux requetes concurrentes passeraient
    toutes les deux.
  */
  async take(userId: string): Promise<PendingRoll | null> {
    const raw = await this.redis.getdel(this.key(userId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PendingRoll;
    } catch {
      this.logger.warn(`action en attente illisible pour ${userId}`);
      return null;
    }
  }

  // Le joueur repart sur autre chose : ce qui attendait n'a plus lieu d'etre.
  async drop(userId: string): Promise<void> {
    await this.redis.del(pendingRollKey(userId));
  }

  /*
    Les actions en attente d'autres joueurs. Dans une partie, le tour de
    l'un fait avancer la scene : ce que les autres attendaient en travers
    d'un jet ne peut plus s'y poser telle quelle. Ils reecriront.
  */
  async dropAll(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.redis.del(...userIds.map(pendingRollKey));
  }
}
