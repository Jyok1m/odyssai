import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../config/app-config.js';
import { AuthController } from './auth.controller.js';
import { OidcService, type TokenSet, type VerifiedIdentity } from './oidc.service.js';
import { SessionService, type StoredSession } from './session.service.js';
import { makeConfig, makeRequest, makeResponse } from './testing/doubles.js';

const TOKENS: TokenSet = {
  access_token: 'access',
  refresh_token: 'refresh',
  id_token: 'id',
  expires_in: 300,
  refresh_expires_in: 1800,
};

const IDENTITY: VerifiedIdentity = {
  sub: 'utilisateur-1',
  email: 'joueur@odyssai.test',
  emailVerified: true,
  roles: ['player'],
};

describe('AuthController', () => {
  let config: AppConfig;
  let oidc: {
    authorizationUrl: ReturnType<typeof vi.fn>;
    registrationUrl: ReturnType<typeof vi.fn>;
    exchangeCode: ReturnType<typeof vi.fn>;
    verifyIdentity: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
    logoutUrl: ReturnType<typeof vi.fn>;
  };
  let sessions: {
    startTransaction: ReturnType<typeof vi.fn>;
    consumeTransaction: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    peek: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  let controller: AuthController;

  beforeEach(() => {
    config = makeConfig();
    oidc = {
      authorizationUrl: vi.fn().mockResolvedValue('https://sso.example.test/auth?x=1'),
      registrationUrl: vi.fn().mockResolvedValue('https://sso.example.test/registrations?x=1'),
      exchangeCode: vi.fn().mockResolvedValue(TOKENS),
      verifyIdentity: vi.fn().mockResolvedValue(IDENTITY),
      revoke: vi.fn().mockResolvedValue(undefined),
      logoutUrl: vi.fn().mockResolvedValue('https://sso.example.test/logout'),
    };
    sessions = {
      startTransaction: vi
        .fn()
        .mockResolvedValue({ state: 'etat-1', nonce: 'nonce-1', codeChallenge: 'defi-1' }),
      consumeTransaction: vi
        .fn()
        .mockResolvedValue({ codeVerifier: 'verificateur', nonce: 'nonce-1', redirectTo: '/jouer' }),
      create: vi.fn().mockResolvedValue('session-1'),
      read: vi.fn().mockResolvedValue(null),
      peek: vi.fn().mockResolvedValue(null),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    controller = new AuthController(
      config,
      oidc as unknown as OidcService,
      sessions as unknown as SessionService,
    );
  });

  describe('signin et signup', () => {
    it('redirige vers la page de connexion et lie la transaction au navigateur', async () => {
      const res = makeResponse();

      const result = await controller.signIn(undefined, res.response);

      expect(result).toEqual({ url: 'https://sso.example.test/auth?x=1', statusCode: 302 });
      const cookie = res.cookies.get(config.cookies.transaction);
      expect(cookie?.value).toBe('etat-1');
      expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    });

    it('vise la page d inscription pour signup', async () => {
      const res = makeResponse();

      const result = await controller.signUp('/jouer', res.response);

      expect(result.url).toBe('https://sso.example.test/registrations?x=1');
      expect(sessions.startTransaction).toHaveBeenCalledWith('/jouer');
    });

    it('refuse une cible de redirection externe', async () => {
      const res = makeResponse();

      await expect(controller.signIn('https://evil.test', res.response)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sessions.startTransaction).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('ouvre la session et revient sur la cible demandee', async () => {
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.transaction]: 'etat-1' });

      const result = await controller.callback({ code: 'code-1', state: 'etat-1' }, req, res.response);

      expect(oidc.exchangeCode).toHaveBeenCalledWith('code-1', 'verificateur');
      expect(oidc.verifyIdentity).toHaveBeenCalledWith(TOKENS, 'nonce-1');
      expect(result).toEqual({ url: 'http://localhost:3000/jouer', statusCode: 302 });

      const cookie = res.cookies.get(config.cookies.session);
      expect(cookie?.value).toBe('session-1');
      expect(cookie?.options.httpOnly).toBe(true);
      expect(cookie?.options.maxAge).toBe(1_800_000);
      expect(res.cleared).toContain(config.cookies.transaction);
    });

    it('rejette un state qui ne vient pas de ce navigateur', async () => {
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.transaction]: 'etat-1' });

      const result = await controller.callback(
        { code: 'code-1', state: 'etat-force' },
        req,
        res.response,
      );

      expect(result.url).toBe('http://localhost:3000/?auth_error=invalid_request');
      expect(oidc.exchangeCode).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejette un retour sans cookie de transaction', async () => {
      const res = makeResponse();

      const result = await controller.callback(
        { code: 'code-1', state: 'etat-1' },
        makeRequest(),
        res.response,
      );

      expect(result.url).toBe('http://localhost:3000/?auth_error=invalid_request');
      expect(oidc.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejette un emetteur inattendu', async () => {
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.transaction]: 'etat-1' });

      const result = await controller.callback(
        { code: 'code-1', state: 'etat-1', iss: 'https://sso.attaquant.test/realms/x' },
        req,
        res.response,
      );

      expect(result.url).toBe('http://localhost:3000/?auth_error=invalid_request');
      expect(oidc.exchangeCode).not.toHaveBeenCalled();
    });

    it('distingue le refus du joueur d une panne du fournisseur', async () => {
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.transaction]: 'etat-1' });

      const refuse = await controller.callback({ error: 'access_denied' }, req, res.response);
      const panne = await controller.callback({ error: 'server_error' }, req, res.response);

      expect(refuse.url).toBe('http://localhost:3000/?auth_error=access_denied');
      expect(panne.url).toBe('http://localhost:3000/?auth_error=provider_error');
    });

    it('ne rejoue pas une transaction deja consommee', async () => {
      sessions.consumeTransaction.mockResolvedValue(null);
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.transaction]: 'etat-1' });

      const result = await controller.callback({ code: 'code-1', state: 'etat-1' }, req, res.response);

      expect(result.url).toBe('http://localhost:3000/?auth_error=invalid_request');
      expect(oidc.exchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('session', () => {
    it('repond non authentifie sans cookie', async () => {
      const res = makeResponse();

      await expect(controller.session(makeRequest(), res.response)).resolves.toEqual({
        authenticated: false,
      });
    });

    it('retire un cookie dont la session n existe plus', async () => {
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.session]: 'session-morte' });

      const state = await controller.session(req, res.response);

      expect(state).toEqual({ authenticated: false });
      expect(res.cleared).toContain(config.cookies.session);
    });

    it('expose l identite sans aucun jeton', async () => {
      const stored: StoredSession = {
        ...IDENTITY,
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        accessExpiresAt: Date.now() + 300_000,
        refreshExpiresAt: Date.now() + 1_800_000,
      };
      sessions.read.mockResolvedValue(stored);
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.session]: 'session-1' });

      const state = await controller.session(req, res.response);

      expect(state).toEqual({
        authenticated: true,
        user: {
          id: 'utilisateur-1',
          email: 'joueur@odyssai.test',
          emailVerified: true,
          roles: ['player'],
        },
      });
      expect(JSON.stringify(state)).not.toContain('refresh');
    });
  });

  describe('signout', () => {
    it('revoque, detruit la session et rend l URL de deconnexion', async () => {
      sessions.peek.mockResolvedValue({
        ...IDENTITY,
        accessToken: 'access',
        refreshToken: 'refresh',
        idToken: 'id',
        accessExpiresAt: Date.now() + 300_000,
        refreshExpiresAt: Date.now() + 1_800_000,
      });
      const res = makeResponse();
      const req = makeRequest({ [config.cookies.session]: 'session-1' });

      const result = await controller.signOut(req, res.response);

      expect(sessions.destroy).toHaveBeenCalledWith('session-1');
      expect(oidc.revoke).toHaveBeenCalledWith('refresh');
      expect(result.logoutUrl).toBe('https://sso.example.test/logout');
      expect(res.cleared).toContain(config.cookies.session);
    });

    it('reste sans effet et sans erreur sans session', async () => {
      const res = makeResponse();

      const result = await controller.signOut(makeRequest(), res.response);

      expect(result.logoutUrl).toBe('http://localhost:3000/');
      expect(oidc.revoke).not.toHaveBeenCalled();
    });
  });
});
