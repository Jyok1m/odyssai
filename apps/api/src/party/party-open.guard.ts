import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AlphaService } from '../alpha/alpha.service.js';

/*
  Le jeu a plusieurs n'ouvre que si le tableau de bord le dit. Il ferme le
  temps de le stabiliser : la feature reste entiere, seules ses deux entrees
  se refusent. A poser apres SessionGuard, dont elle relit le joueur.

  Un administrateur passe toujours : c'est ainsi qu'on verifie la table avant
  de l'ouvrir. Sortir d'une table ne se refuse pas, et se relire non plus :
  cette garde ne tient que l'ouverture et l'entree.
*/
@Injectable()
export class PartyOpenGuard implements CanActivate {
  constructor(private readonly alpha: AlphaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.odyssaiUser?.isAdmin) return true;
    if (await this.alpha.partyOpen()) return true;

    throw new ForbiddenException({ code: 'party_closed' });
  }
}
