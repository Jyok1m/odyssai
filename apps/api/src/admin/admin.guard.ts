import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

/**
 * Le droit d'administrer.
 *
 * A poser **apres** `SessionGuard`, dont il relit le joueur : Nest execute les
 * gardes dans l'ordre de leur declaration, et seul est vrai ce que le premier
 * a depose sur la requete.
 *
 * `users.is_admin` n'est modifiable par aucune route, ni par le tableau de
 * bord lui-meme : se donner le droit demande un acces a la base
 * (`pnpm --filter @odyssai/api admin:grant <email>`). Un dashboard qui peut
 * nommer des administrateurs transforme une session volee en prise de
 * controle definitive.
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
