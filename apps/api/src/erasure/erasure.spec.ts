import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@odyssai/db';
import type Stripe from 'stripe';
import { ErasureService } from './erasure.service.js';

/**
 * La resiliation au depart.
 *
 * Un abonnement qui survit a son proprietaire preleve quelqu'un qui n'a plus
 * de compte pour l'arreter. C'est le genre de defaut qu'on decouvre par un
 * relance bancaire, donc il se teste.
 */
describe('depart et abonnement', () => {
  function serviceFor(
    stripeSubscriptionId: string | null,
    stripe: { subscriptions: { cancel: ReturnType<typeof vi.fn> } } | null,
  ) {
    const order: string[] = [];

    const prisma = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(
          stripeSubscriptionId ? { stripeSubscriptionId } : null,
        ),
      },
      universe: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        delete: vi.fn(() => {
          order.push('user.delete');
          return Promise.resolve({});
        }),
      },
      $transaction: vi.fn(),
    };

    if (stripe) {
      stripe.subscriptions.cancel.mockImplementation(() => {
        order.push('stripe.cancel');
        return Promise.resolve({});
      });
    }

    const service = new ErasureService(
      prisma as unknown as PrismaClient,
      stripe as unknown as Stripe | null,
    );

    return { service, order };
  }

  it('resilie chez Stripe avant d effacer la ligne', async () => {
    const cancel = vi.fn();
    const { service, order } = serviceFor('sub_1', { subscriptions: { cancel } });

    await service.eraseAccount('u1');

    expect(cancel).toHaveBeenCalledWith('sub_1');
    // La cascade sur `users` emporte l'abonnement : apres, l'identifiant
    // Stripe n'existe plus et personne ne saurait quoi annuler.
    expect(order).toEqual(['stripe.cancel', 'user.delete']);
  });

  it('n appelle rien pour un joueur sans abonnement', async () => {
    const cancel = vi.fn();
    const { service } = serviceFor(null, { subscriptions: { cancel } });

    await service.eraseAccount('u1');

    expect(cancel).not.toHaveBeenCalled();
  });

  // Le droit a l'effacement ne se suspend pas a la disponibilite d'un tiers.
  it('efface quand meme si Stripe refuse', async () => {
    const cancel = vi.fn();
    const { service, order } = serviceFor('sub_1', { subscriptions: { cancel } });
    // Apres serviceFor, qui pose sa propre implementation pour l'ordre.
    cancel.mockRejectedValue(new Error('stripe indisponible'));

    await expect(service.eraseAccount('u1')).resolves.toBeDefined();
    expect(order).toEqual(['user.delete']);
  });
});
