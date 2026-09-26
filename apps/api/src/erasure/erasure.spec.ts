import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@odyssai/db';
import type Stripe from 'stripe';
import type { Redis } from 'ioredis';
import { ErasureService } from './erasure.service.js';
import type { CreditsService } from '../credits/credits.service.js';
import { FakeRedis } from '../auth/testing/doubles.js';
import {
  makeOnboardingPrisma,
  makeUser,
  type CharacterRow,
  type OnboardingStore,
  type UniverseRow,
} from '../onboarding/testing/doubles.js';

/*
  La resiliation au depart.

  Un abonnement qui survit a son proprietaire preleve quelqu'un qui n'a plus
  de compte pour l'arreter. C'est le genre de defaut qu'on decouvre par un
  relance bancaire, donc il se teste.
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
      universe: { findMany: vi.fn().mockResolvedValue([]) },
      partyMember: { findMany: vi.fn().mockResolvedValue([]) },
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
      { del: vi.fn() } as unknown as Redis,
      { refund: vi.fn() } as unknown as CreditsService,
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

/*
  Le depart d'une table, au niveau du service : ce qui reste du partant, et
  ce que le dernier sortant emporte. Sur le double en memoire, qui reproduit
  les cascades et les SetNull de la base.
*/
describe('depart d une table', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');

  function table() {
    const host = makeUser({ username: 'Hote', usernameFolded: 'hote' });
    const friend = makeUser({
      keycloakId: 'sujet-ami',
      username: 'Ami',
      usernameFolded: 'ami',
      email: 'ami@example.test',
    });
    const universe: UniverseRow = {
      id: 'univers-table',
      ownerId: host.id,
      step: 'ready',
      mode: null,
      works: [],
      ownDescription: null,
      themes: null,
      charter: null,
      bible: null,
      name: 'Sarek',
      accentHue: 32,
      arcAct: null,
      isOpen: false,
      visitingId: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    host.currentUniverseId = universe.id;
    friend.currentUniverseId = universe.id;

    const character = (id: string, ownerId: string, name: string): CharacterRow => ({
      id,
      universeId: universe.id,
      ownerId,
      name,
      gender: 'femme',
      age: 30,
      personality: { traits: ['tenace'], summary: `${name}, ecrit par son joueur.` },
      attributes: null,
      talents: [],
      inventory: [],
      progress: null,
      hp: null,
      rest: 0,
      essenceId: null,
      arrival: 'natif',
      diedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const message = (
      id: string,
      channel: string,
      memberId: string | null,
      role: 'user' | 'assistant',
      seq: number,
    ) => ({ id, universeId: universe.id, channel, role, content: `texte ${id}`, memberId, seq, createdAt: NOW });

    const store: OnboardingStore = {
      users: [host, friend],
      universes: [universe],
      characters: [character('ael', host.id, 'Ael'), character('bren', friend.id, 'Bren')],
      messages: [
        message('fil-hote', 'character_creation', host.id, 'user', 0),
        message('fil-ami', 'character_creation', friend.id, 'user', 1),
        message('dit-hote', 'game_turn', host.id, 'user', 0),
        message('recit-1', 'game_turn', null, 'assistant', 1),
        message('dit-ami', 'game_turn', friend.id, 'user', 2),
        message('recit-2', 'game_turn', null, 'assistant', 3),
      ],
      jobs: [],
      parties: [
        { id: 'table', universeId: universe.id, size: 2, inviteCode: 'ABCDEFGH', createdAt: NOW, updatedAt: NOW },
      ],
      partyMembers: [
        { id: 's1', partyId: 'table', userId: host.id, works: [], ready: true, isHost: true, joinedAt: NOW },
        { id: 's2', partyId: 'table', userId: friend.id, works: [], ready: true, isHost: false, joinedAt: new Date(NOW.getTime() + 1) },
      ],
    };

    const service = new ErasureService(
      makeOnboardingPrisma(store) as unknown as PrismaClient,
      null,
      new FakeRedis() as unknown as Redis,
      { refund: vi.fn() } as unknown as CreditsService,
    );

    return { store, service, host, friend, universe };
  }

  const text = (store: OnboardingStore, id: string) =>
    store.messages.find((row) => row.id === id);

  it('un membre qui part laisse sa tombe et ses rangs, pas ses mots ni son fil', async () => {
    const { store, service, friend } = table();

    await expect(service.releaseMembership(friend.id)).resolves.toEqual({
      world: 'kept',
      character: 'remembered',
    });

    expect(text(store, 'dit-ami')).toMatchObject({ content: '', seq: 2, memberId: friend.id });
    expect(text(store, 'dit-hote')?.content).toBe('texte dit-hote');
    expect(text(store, 'fil-ami')).toBeUndefined();
    expect(text(store, 'fil-hote')).toBeDefined();
    expect(store.characters.find((row) => row.id === 'bren')?.diedAt).toBeInstanceOf(Date);
    expect(store.characters.find((row) => row.id === 'ael')?.diedAt).toBeNull();
  });

  it('un membre qui efface son compte emporte sa fiche et delie ses messages', async () => {
    const { store, service, host, friend } = table();

    await service.eraseAccount(friend.id);

    expect(text(store, 'dit-ami')).toMatchObject({ content: '', seq: 2, memberId: null });
    expect(text(store, 'fil-ami')).toBeUndefined();
    expect(store.characters.map((row) => row.id)).toEqual(['ael']);
    expect(store.universes[0]!.ownerId).toBe(host.id);
    expect(store.users.map((row) => row.id)).toEqual([host.id]);
  });

  it('l hote qui efface son compte laisse le monde a l ami', async () => {
    const { store, service, friend } = table();

    await service.eraseAccount(store.users[0]!.id);

    expect(store.universes[0]!.ownerId).toBe(friend.id);
    expect(store.partyMembers?.map((row) => row.userId)).toEqual([friend.id]);
    expect(text(store, 'dit-hote')).toMatchObject({ content: '', memberId: null });
    expect(store.characters.map((row) => row.id)).toEqual(['bren']);
  });

  it('le dernier sortant n emporte pas de tombe orpheline', async () => {
    const { store, service, host, friend, universe } = table();

    await service.releaseMembership(friend.id);
    await expect(service.releaseMembership(host.id)).resolves.toEqual({
      world: 'deleted',
      character: 'deleted',
    });

    expect(store.universes.some((row) => row.id === universe.id)).toBe(false);
    expect(store.characters).toHaveLength(0);
    expect(store.parties ?? []).toHaveLength(0);
  });
});
