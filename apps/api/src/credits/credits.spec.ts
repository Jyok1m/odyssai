import { describe, expect, it } from 'vitest';
import { CREDIT_COSTS, creditsFor, nextPeriod, planOf } from '@odyssai/engine';

describe('bareme', () => {
  it('prend le tour pour unite', () => {
    expect(creditsFor('turn')).toBe(1);
  });

  // Faire payer au joueur le fait qu'on le surveille serait indefendable.
  it('ne facture pas ce qui n est pas un service rendu', () => {
    expect(creditsFor('characterExtract')).toBe(0);
  });

  it('fait payer un monde a la hauteur de ce qu il coute', () => {
    expect(CREDIT_COSTS.worldGeneration).toBeGreaterThanOrEqual(
      CREDIT_COSTS.turn * 7,
    );
  });

  it('retombe sur le palier libre pour un plan inconnu', () => {
    expect(planOf('inexistant').id).toBe('free');
  });

  // Le palier libre doit couvrir un monde et une vraie session.
  it('offre de quoi voir ce qu on achete', () => {
    const free = planOf('free');
    expect(free.welcome).toBe(CREDIT_COSTS.worldGeneration);
    expect(free.monthly).toBeGreaterThanOrEqual(30);
  });
});

describe('ancrage des periodes', () => {
  it('avance d un mois', () => {
    expect(nextPeriod(new Date('2026-01-20T10:00:00Z')).toISOString()).toBe(
      '2026-02-20T10:00:00.000Z',
    );
  });

  /**
   * Le piege de `setMonth` : le 31 janvier plus un mois donne le 3 mars, parce
   * que fevrier n'a pas de 31. Un abonne du 31 doit rester au dernier jour.
   */
  it('ne deborde pas sur le mois suivant', () => {
    expect(nextPeriod(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(nextPeriod(new Date('2026-03-31T10:00:00Z')).toISOString()).toBe(
      '2026-04-30T10:00:00.000Z',
    );
  });

  it('tient une annee bissextile', () => {
    expect(nextPeriod(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });

  it('passe une fin d annee', () => {
    expect(nextPeriod(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe(
      '2027-01-15T10:00:00.000Z',
    );
  });
});
