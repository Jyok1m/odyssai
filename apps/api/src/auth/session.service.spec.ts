import { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OidcService, type TokenSet, type VerifiedIdentity } from './oidc.service.js';
import { SessionService } from './session.service.js';
import { FakeRedis } from './testing/doubles.js';

const IDENTITY: VerifiedIdentity = {
  sub: 'utilisateur-1',
  email: 'joueur@odyssai.test',
  emailVerified: true,
  roles: ['player'],
};

function tokens(suffix: string, expiresIn = 300): TokenSet {
  return {
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    id_token: `id-${suffix}`,
    expires_in: expiresIn,
    refresh_expires_in: 1800,
  };
}

describe('SessionService', () => {
  let redis: FakeRedis;
  let oidc: { refresh: ReturnType<typeof vi.fn> };
  let sessions: SessionService;

  beforeEach(() => {
    redis = new FakeRedis();
    oidc = { refresh: vi.fn().mockResolvedValue(tokens('2')) };
    sessions = new SessionService(
      redis as unknown as Redis,
      oidc as unknown as OidcService,
    );
  });

  describe('transactions', () => {
    it('produit un defi PKCE different a chaque appel', async () => {
      const first = await sessions.startTransaction('/jouer');
      const second = await sessions.startTransaction('/jouer');

      expect(first.state).not.toBe(second.state);
      expect(first.nonce).not.toBe(second.nonce);
      expect(first.codeChallenge).not.toBe(second.codeChallenge);
    });

    it('ne rend une transaction qu une seule fois', async () => {
      const { state } = await sessions.startTransaction('/jouer');

      await expect(sessions.consumeTransaction(state)).resolves.toMatchObject({
        redirectTo: '/jouer',
      });
      await expect(sessions.consumeTransaction(state)).resolves.toBeNull();
    });

    it('ignore un state inconnu', async () => {
      await expect(sessions.consumeTransaction('state-invente')).resolves.toBeNull();
    });
  });

  describe('cycle de vie', () => {
    it('relit une session ouverte sans renouveler', async () => {
      const id = await sessions.create(tokens('1'), IDENTITY);

      const session = await sessions.read(id);

      expect(session?.accessToken).toBe('access-1');
      expect(oidc.refresh).not.toHaveBeenCalled();
    });

    it('rend null apres destruction', async () => {
      const id = await sessions.create(tokens('1'), IDENTITY);

      await sessions.destroy(id);

      await expect(sessions.read(id)).resolves.toBeNull();
    });
  });

  describe('renouvellement', () => {
    it('renouvelle un access token arrive a echeance', async () => {
      // expires_in tres court : la session naissante est deja dans la marge
      // de renouvellement.
      const id = await sessions.create(tokens('1', 1), IDENTITY);

      const session = await sessions.read(id);

      expect(oidc.refresh).toHaveBeenCalledWith('refresh-1');
      expect(session?.accessToken).toBe('access-2');
      expect(session?.refreshToken).toBe('refresh-2');
    });

    it('ne renouvelle qu une fois pour deux lectures simultanees', async () => {
      // Le realm est en rotation stricte : un second renouvellement avec le
      // meme refresh token serait lu comme un rejeu et tuerait la session.
      oidc.refresh.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return tokens('2');
      });
      const id = await sessions.create(tokens('1', 1), IDENTITY);

      const [first, second] = await Promise.all([sessions.read(id), sessions.read(id)]);

      expect(oidc.refresh).toHaveBeenCalledTimes(1);
      expect(first?.accessToken).toBe('access-2');
      expect(second?.accessToken).toBe('access-2');
    });

    it('detruit la session quand Keycloak refuse le renouvellement', async () => {
      oidc.refresh.mockRejectedValue(new Error('invalid_grant'));
      const id = await sessions.create(tokens('1', 1), IDENTITY);

      await expect(sessions.read(id)).resolves.toBeNull();
      await expect(sessions.peek(id)).resolves.toBeNull();
    });

    it('libere le verrou apres un renouvellement', async () => {
      const id = await sessions.create(tokens('1', 1), IDENTITY);

      await sessions.read(id);

      // Seule la cle de session subsiste, le verrou a ete rendu.
      expect(redis.size()).toBe(1);
    });
  });
});
