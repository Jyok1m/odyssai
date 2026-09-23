import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@odyssai/db';
import { UsersService } from './users.service.js';

const IDENTITY = {
  keycloakId: 'kc-1',
  email: 'joueur@odyssai.test',
  emailVerified: true,
};

/*
  Le provisionnement. Plus de porte a cent places : la ligne d'un joueur nait
  a sa premiere connexion, et un joueur connu revient sans qu'on compte quoi
  que ce soit. Le bonus des premiers inscrits, lui, se lit a part.
*/
describe('provisionnement', () => {
  function serviceFor() {
    const prisma = {
      user: {
        count: vi.fn(),
        upsert: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
    };

    return {
      service: new UsersService(prisma as unknown as PrismaClient),
      prisma,
    };
  }

  it('fait naitre la ligne a la premiere connexion, sans compter personne', async () => {
    const { service, prisma } = serviceFor();

    await expect(service.signIn(IDENTITY)).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.upsert).toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
