import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@odyssai/db';
import type { AuthenticatedRequest } from './session.guard.js';

/**
 * Ligne applicative du joueur courant. Purement synchrone : SessionGuard l'a
 * deja resolue, le decorateur ne fait que la relire. A n'employer que derriere
 * ce guard, sans quoi il n'y a rien a lire.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>()
      .odyssaiUser;
  },
);
