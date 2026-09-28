import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { User } from '@odyssai/db';
import { PartyOpenGuard } from './party-open.guard.js';
import type { AlphaService } from '../alpha/alpha.service.js';

function contextFor(user: Partial<User> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ odyssaiUser: user }) }),
  } as unknown as ExecutionContext;
}

function guardFor(open: boolean): PartyOpenGuard {
  return new PartyOpenGuard({ partyOpen: async () => open } as unknown as AlphaService);
}

describe('garde du jeu a plusieurs', () => {
  it('laisse passer tout le monde quand la table est ouverte', async () => {
    await expect(guardFor(true).canActivate(contextFor({ id: 'u1', isAdmin: false }))).resolves.toBe(true);
  });

  it('refuse un joueur ordinaire tant que la table est fermee, avec son code', async () => {
    await expect(guardFor(false).canActivate(contextFor({ id: 'u2', isAdmin: false }))).rejects.toMatchObject({
      response: { code: 'party_closed' },
    });
    await expect(guardFor(false).canActivate(contextFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Un administrateur verifie la table avant de l'ouvrir : il passe sans
  // meme que le reglage soit lu.
  it('laisse passer un administrateur que la table soit ouverte ou non', async () => {
    const guard = new PartyOpenGuard({
      partyOpen: async () => {
        throw new Error('ne doit pas etre lu');
      },
    } as unknown as AlphaService);
    await expect(guard.canActivate(contextFor({ id: 'u3', isAdmin: true }))).resolves.toBe(true);
  });
});
