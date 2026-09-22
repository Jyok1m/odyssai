import { describe, expect, it } from 'vitest';
import { GUIDANCE } from '@odyssai/narrator';
import { SituationSchema, type Situation } from '@odyssai/schemas';
import { TUNING } from '@odyssai/engine';

const SITUATIONS = SituationSchema.options as readonly Situation[];

describe('fiches de maitrise', () => {
  it('rend au moins une fiche pour chaque situation', () => {
    for (const situation of SITUATIONS) {
      expect(GUIDANCE.for(situation, 'fr'), situation).not.toHaveLength(0);
    }
  });

  it('ne rend jamais plus que la borne', () => {
    for (const situation of SITUATIONS) {
      expect(
        GUIDANCE.for(situation, 'fr').length,
        situation,
      ).toBeLessThanOrEqual(TUNING.turn.guidanceMax);
    }
  });

  /*
    Une fiche placee au dela de la borne dans toutes ses listes serait du texte
    qu'on relit et que personne ne lit jamais. Rien dans le type ne l'empeche.
  */
  it("n'abandonne aucune fiche hors de portee de la borne", () => {
    const served = new Set(
      SITUATIONS.flatMap((situation) => GUIDANCE.for(situation, 'fr')),
    );

    const unreachable = GUIDANCE.cards
      .filter((card) => !served.has(card.fr))
      .map((card) => card.id);

    expect(unreachable).toEqual([]);
  });

  it('porte les deux langues sur chaque fiche', () => {
    for (const card of GUIDANCE.cards) {
      expect(card.fr.trim(), card.id).not.toBe('');
      expect(card.en.trim(), card.id).not.toBe('');
      // L'un traduit l'autre, il ne le recopie pas.
      expect(card.en, card.id).not.toBe(card.fr);
    }
  });

  it('donne un identifiant unique a chaque fiche', () => {
    const ids = GUIDANCE.cards.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne rappelle rien sans situation', () => {
    expect(GUIDANCE.for(null, 'fr')).toEqual([]);
  });

  it('rend chaque fiche dans la langue demandee', () => {
    const [fr] = GUIDANCE.for('meta', 'fr');
    const [en] = GUIDANCE.for('meta', 'en');

    expect(fr).toContain('fiction');
    expect(en).toContain('fiction');
    expect(fr).not.toBe(en);
  });
});
