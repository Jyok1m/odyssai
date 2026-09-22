import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_MAX } from '@odyssai/schemas';
import { PROGRESS_STEPS, grewTo, usesAfter } from '@odyssai/engine';

describe('la montee d un attribut', () => {
  it('ne bouge pas avant le palier', () => {
    expect(grewTo(3, PROGRESS_STEPS[3]! - 1)).toBeNull();
  });

  it('monte d un point au palier', () => {
    expect(grewTo(3, PROGRESS_STEPS[3]!)).toBe(4);
  });

  /*
    Cinq doit rester remarquable : c'est le plafond de l'echelle, et rien au
    dela n'aurait de sens pour un modificateur qui s'arrete a +2.
  */
  it('ne depasse jamais le maximum', () => {
    expect(grewTo(ATTRIBUTE_MAX, 1000)).toBeNull();
  });

  // Plus on est haut, plus c'est long : une patience ne remplace pas un don.
  it('demande de plus en plus de jets', () => {
    const steps = [1, 2, 3, 4].map((score) => PROGRESS_STEPS[score]!);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('compte le jet en cours', () => {
    expect(usesAfter({}, 'corps')).toBe(1);
    expect(usesAfter({ corps: 2 }, 'corps')).toBe(3);
    expect(usesAfter({ adresse: 7 }, 'corps')).toBe(1);
  });

  /*
    Un vrai defaut se corrige dans la partie ou il gene, un cinq ne s'atteint
    pas par accident : c'est tout le reglage, et il se lit ici.
  */
  it('coute quelques tours en bas, beaucoup en haut', () => {
    expect(PROGRESS_STEPS[1]).toBeLessThanOrEqual(4);
    expect(PROGRESS_STEPS[4]).toBeGreaterThanOrEqual(12);
  });
});
