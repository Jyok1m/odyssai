import { describe, expect, it } from 'vitest';
import { partyShare, CREDIT_COSTS } from '@odyssai/engine';
import {
  PARTY_CODE_LENGTH,
  PARTY_MAX,
  PARTY_MIN,
  PartyJoinSchema,
  PartyStartSchema,
  normalizePartyCode,
} from '@odyssai/schemas';

/*
  Les regles de table, pures : le pli du code d'invitation, la borne des
  tailles, et la part de chacun dans le monde. Le reste des tables se joue en
  e2e, ou l'aller-retour complet est un vrai test.
*/
describe('regles de table', () => {
  it('plie le code sans casse ni separateur', () => {
    expect(normalizePartyCode('2345-6789')).toBe('23456789');
    expect(normalizePartyCode(' 23456789 ')).toBe('23456789');
    expect(normalizePartyCode('aBcDeFgH')).toBe('ABCDEFGH');
  });

  it('rejette un code trop court apres pli', () => {
    // C'est la table qui tranche ensuite : un code plie trop court ne
    // correspond a rien, et le service le refuse comme inconnu.
    expect(normalizePartyCode('234-567')).not.toHaveLength(PARTY_CODE_LENGTH);
    expect(PartyJoinSchema.safeParse({ code: '' }).success).toBe(false);
  });

  it('borne la taille d une table entre deux et quatre', () => {
    expect(PartyStartSchema.safeParse({ size: PARTY_MIN }).success).toBe(true);
    expect(PartyStartSchema.safeParse({ size: PARTY_MAX }).success).toBe(true);
    expect(PartyStartSchema.safeParse({ size: 1 }).success).toBe(false);
    expect(PartyStartSchema.safeParse({ size: 5 }).success).toBe(false);
    expect(PartyStartSchema.safeParse({ size: 2.5 }).success).toBe(false);
  });

  /*
    La part de chacun, arrondie au credit superieur : un credit est la plus
    petite unite, et arrondir en dessous ferait un monde partage moins cher
    qu'un monde solo. Le total collecte depasse le prix d'au plus (taille -
    1) credits, jamais l'inverse.
  */
  it('partage le prix du monde, arrondi au credit superieur', () => {
    expect(partyShare(2)).toBe(Math.ceil(CREDIT_COSTS.worldGeneration / 2));
    expect(partyShare(3)).toBe(Math.ceil(CREDIT_COSTS.worldGeneration / 3));
    expect(partyShare(4)).toBe(Math.ceil(CREDIT_COSTS.worldGeneration / 4));

    for (const size of [2, 3, 4]) {
      expect(partyShare(size) * size).toBeGreaterThanOrEqual(
        CREDIT_COSTS.worldGeneration,
      );
      expect(partyShare(size) * size - CREDIT_COSTS.worldGeneration).toBeLessThan(
        size,
      );
    }
  });

  it('un solo garde le prix entier, une table le partage', () => {
    expect(partyShare(1)).toBe(CREDIT_COSTS.worldGeneration);
  });
});
