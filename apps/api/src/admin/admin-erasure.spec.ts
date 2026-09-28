import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, User } from '@odyssai/db';
import type { DepartureOutcome } from '@odyssai/schemas';
import { AdminService, SelfDeletionError, UserNotFoundError } from './admin.service.js';
import type { BillingConfig } from '../config/billing-config.js';
import type { CreditsService } from '../credits/credits.service.js';
import type { ErasureService } from '../erasure/erasure.service.js';
import type { PlansService } from '../plans/plans.service.js';

/*
  La suppression d'un joueur depuis le tableau de bord.

  Ce qui se verifie ici est la delegation, pas le depart lui-meme : celui-la
  est deja couvert par `erasure.spec.ts`, et le recopier ferait deux jeux de
  tests qui divergeraient. Ce qui compte, c'est qu'aucune autre regle ne
  s'intercale, et qu'un echec de la base ne soit pas avale.
*/

const OUTCOME: DepartureOutcome = { world: 'deleted', character: 'deleted' };

const ADMIN = { id: 'admin-1' } as User;

function serviceFor(options: {
  found?: boolean;
  erase?: () => Promise<DepartureOutcome>;
}) {
  const findUnique = vi
    .fn()
    .mockResolvedValue(options.found === false ? null : { id: 'joueur-1' });

  const eraseAccount = vi.fn(options.erase ?? (() => Promise.resolve(OUTCOME)));

  const service = new AdminService(
    { user: { findUnique } } as unknown as PrismaClient,
    {} as PlansService,
    {} as CreditsService,
    {} as BillingConfig,
    { eraseAccount } as unknown as ErasureService,
  );

  return { service, eraseAccount, findUnique };
}

describe('suppression d un joueur par un administrateur', () => {
  it('passe par la regle du depart, sans en ecrire une seconde', async () => {
    const { service, eraseAccount } = serviceFor({});

    await expect(service.deleteUser('joueur-1', ADMIN)).resolves.toBeUndefined();

    expect(eraseAccount).toHaveBeenCalledWith('joueur-1');
    expect(eraseAccount).toHaveBeenCalledTimes(1);
  });

  /*
    Un joueur deja parti n'est pas une panne : l'ecran a pu etre ouvert avant
    son depart, et le refus doit se lire comme un 404, pas comme un 500.
  */
  it('refuse un joueur introuvable sans rien effacer', async () => {
    const { service, eraseAccount } = serviceFor({ found: false });

    await expect(service.deleteUser('fantome', ADMIN)).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  /*
    Le droit d'administrer ne se repose par aucune route : se supprimer d'ici
    laisserait un tableau de bord sans personne pour y entrer.
  */
  it('refuse a un administrateur de s effacer lui-meme', async () => {
    const { service, eraseAccount, findUnique } = serviceFor({});

    await expect(service.deleteUser(ADMIN.id, ADMIN)).rejects.toBeInstanceOf(
      SelfDeletionError,
    );
    // Avant meme la lecture : la question ne se pose pas.
    expect(findUnique).not.toHaveBeenCalled();
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  /*
    Une panne de la base remonte telle quelle. L'avaler rendrait un 204 sur un
    compte toujours la, et l'administrateur croirait avoir supprime quelqu'un
    qui joue encore.
  */
  it('laisse remonter une panne de la base', async () => {
    const panne = new Error('database unavailable');
    const { service } = serviceFor({ erase: () => Promise.reject(panne) });

    await expect(service.deleteUser('joueur-1', ADMIN)).rejects.toBe(panne);
  });

  it('laisse remonter une panne survenue a la lecture', async () => {
    const panne = new Error('connection terminated');
    const service = new AdminService(
      { user: { findUnique: vi.fn().mockRejectedValue(panne) } } as unknown as PrismaClient,
      {} as PlansService,
      {} as CreditsService,
      {} as BillingConfig,
      { eraseAccount: vi.fn() } as unknown as ErasureService,
    );

    await expect(service.deleteUser('joueur-1', ADMIN)).rejects.toBe(panne);
  });
});
