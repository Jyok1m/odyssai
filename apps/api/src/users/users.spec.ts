import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@odyssai/db';
import { ALPHA_SEATS } from '@odyssai/engine';
import { AlphaFullError, UsersService } from './users.service.js';

const IDENTITY = {
  keycloakId: 'kc-1',
  email: 'joueur@odyssai.test',
  emailVerified: true,
};

/*
  Les places de l'alpha.

  La regle se joue au provisionnement et nulle part ailleurs : c'est la seule
  ecriture qui fait naitre un joueur. Un test parce qu'une erreur ici ne se
  verrait qu'au centieme inscrit, c'est a dire trop tard.
*/
describe('places de l alpha', () => {
  function serviceFor(taken: number, known: boolean) {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(known ? { id: 'u1' } : null),
        count: vi.fn().mockResolvedValue(taken),
        upsert: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
    };

    return {
      service: new UsersService(prisma as unknown as PrismaClient),
      prisma,
    };
  }

  it('laisse entrer tant qu il reste une place', async () => {
    const { service, prisma } = serviceFor(ALPHA_SEATS - 1, false);

    await expect(service.signIn(IDENTITY)).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.upsert).toHaveBeenCalled();
  });

  it('refuse la centieme et unieme inscription', async () => {
    const { service, prisma } = serviceFor(ALPHA_SEATS, false);

    await expect(service.signIn(IDENTITY)).rejects.toThrow(AlphaFullError);
    // Rien n'est ecrit : la ligne ne doit pas naitre a moitie.
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // Une place prise reste prise : la fermeture ne vaut que pour les nouveaux.
  it('laisse revenir un joueur deja inscrit', async () => {
    const { service, prisma } = serviceFor(ALPHA_SEATS + 20, true);

    await expect(service.signIn(IDENTITY)).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.user.upsert).toHaveBeenCalled();
  });

  // Ils doivent pouvoir entrer pour verifier ce qu'ils livrent.
  it('ne compte pas les administrateurs', async () => {
    const { service, prisma } = serviceFor(0, false);

    await service.signIn(IDENTITY);

    expect(prisma.user.count).toHaveBeenCalledWith({ where: { isAdmin: false } });
  });

  it('dit la fermeture sans rien ecrire', async () => {
    const { service, prisma } = serviceFor(ALPHA_SEATS, false);

    await expect(service.alphaFull()).resolves.toBe(true);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
