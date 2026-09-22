import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { User } from '@odyssai/db';
import { AdminGuard } from './admin.guard.js';

function contextFor(user: Partial<User> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ odyssaiUser: user }) }),
  } as unknown as ExecutionContext;
}

describe('garde d administration', () => {
  const guard = new AdminGuard();

  it('laisse passer un administrateur', () => {
    expect(guard.canActivate(contextFor({ id: 'u1', isAdmin: true }))).toBe(true);
  });

  it('refuse un joueur ordinaire', () => {
    expect(() => guard.canActivate(contextFor({ id: 'u2', isAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  /*
    Le cas qui compte : ce garde doit etre pose apres SessionGuard, qui depose
    le joueur. Seul, il ne voit rien, et doit refuser plutot que laisser
    passer. Une erreur d'ordre dans un decorateur ouvrirait sinon tout le
    tableau de bord a un anonyme.
  */
  it('refuse quand aucune session n a ete resolue', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
