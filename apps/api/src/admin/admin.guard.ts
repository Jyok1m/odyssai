import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

/*
  A poser apres `SessionGuard`, dont il relit le joueur : Nest execute les
  gardes dans l'ordre de declaration, et inverses celui-ci ne verrait rien.

  `users.is_admin` n'est modifiable par aucune route, pas meme par le tableau
  de bord (`admin:grant`, donc un acces au serveur) : un dashboard qui nomme
  des administrateurs transforme une session volee en prise de controle.
*/
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.odyssaiUser;

    if (!user?.isAdmin) {
      // Journalise : une tentative sur ces routes vaut d'etre vue, et
      // l'identifiant suffit a savoir qui sans recopier son adresse.
      this.logger.warn(`acces refuse au tableau de bord : ${user?.id ?? 'inconnu'}`);
      throw new ForbiddenException({ code: 'forbidden' });
    }

    return true;
  }
}
