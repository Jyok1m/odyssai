import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { User } from '@odyssai/db';
import { AlphaOpenGuard } from './alpha-open.guard.js';
import type { AlphaService } from './alpha.service.js';

function contextFor(user: Partial<User> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ odyssaiUser: user }) }),
  } as unknown as ExecutionContext;
}

function guardFor(open: boolean): AlphaOpenGuard {
  return new AlphaOpenGuard({ isOpen: async () => open } as unknown as AlphaService);
}

describe('garde d ouverture du jeu', () => {
  it('laisse passer tout le monde quand la phase est ouverte', async () => {
    await expect(guardFor(true).canActivate(contextFor({ id: 'u1', isAdmin: false }))).resolves.toBe(true);
  });

  it('refuse un joueur ordinaire tant que la phase est fermee, avec son code', async () => {
    await expect(guardFor(false).canActivate(contextFor({ id: 'u2', isAdmin: false }))).rejects.toMatchObject({
      response: { code: 'alpha_closed' },
    });
    await expect(guardFor(false).canActivate(contextFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Un administrateur verifie la production avant d ouvrir : il passe sans
  // meme que la phase soit lue.
  it('laisse passer un administrateur quelle que soit la phase', async () => {
    const guard = new AlphaOpenGuard({
      isOpen: async () => {
        throw new Error('ne doit pas etre lu');
      },
    } as unknown as AlphaService);
    await expect(guard.canActivate(contextFor({ id: 'u3', isAdmin: true }))).resolves.toBe(true);
  });
});
