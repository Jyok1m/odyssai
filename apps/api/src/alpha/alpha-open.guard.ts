import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AlphaService } from './alpha.service.js';

/*
  Le jeu n'est ouvert que si la phase de l'alpha le dit, et c'est le tableau
  de bord qui la regle : ouvrir est une decision qui se prend un matin, pas un
  deploiement. A poser apres SessionGuard, dont il relit le joueur.

  Un administrateur passe toujours : c'est ainsi qu'on verifie la production
  avant d'ouvrir. Cote web, la meme regle n'est qu'une commodite (un toast sur
  le lien, une page qui le dit) ; la regle est ici.
*/
@Injectable()
export class AlphaOpenGuard implements CanActivate {
  constructor(private readonly alpha: AlphaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.odyssaiUser?.isAdmin) return true;
    if (await this.alpha.isOpen()) return true;

    throw new ForbiddenException({ code: 'alpha_closed' });
  }
}
