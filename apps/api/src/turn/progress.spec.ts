import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_MAX } from '@odyssai/schemas';
import { PROGRESS_STEPS, carryAfter, grewTo, usesAfter } from '@odyssai/engine';

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

/*
  L'inventaire : le modele dit ce qui a change de main, le code decide de ce
  qui est porte. Aucun etat n'est deduit du texte, et ce bloc de queue est une
  declaration comme une autre.
*/
describe('ce que le personnage porte', () => {
  it('prend et perd', () => {
    expect(carryAfter(['epee'], ['torche'], [], 10)).toEqual(['epee', 'torche']);
    expect(carryAfter(['epee', 'torche'], [], ['epee'], 10)).toEqual(['torche']);
  });

  /*
    Il ecrit « l'Epee » la ou il avait ecrit « epee corrompue » : la
    comparaison est normalisee, sinon un objet perdu resterait au sac.
  */
  it('retrouve un objet malgre la casse et les accents', () => {
    expect(carryAfter(['épée corrompue'], [], ['Epee Corrompue'], 10)).toEqual([]);
  });

  it('ignore ce qu il ne porte pas', () => {
    expect(carryAfter(['epee'], [], ['bouclier'], 10)).toEqual(['epee']);
  });

  it('ne prend pas deux fois le meme objet', () => {
    expect(carryAfter(['torche'], ['Torche'], [], 10)).toEqual(['torche']);
  });

  /*
    Sac plein : le nouvel objet n'entre pas. Faire sortir le plus ancien ferait
    perdre une epee pour trois cailloux, et une disparition silencieuse se
    comprend moins bien qu'un sac plein.
  */
  it('refuse au dela de la borne plutot que de vider le sac', () => {
    expect(carryAfter(['a', 'b'], ['c'], [], 2)).toEqual(['a', 'b']);
  });

  it('fait de la place avant de prendre', () => {
    expect(carryAfter(['a', 'b'], ['c'], ['a'], 2)).toEqual(['b', 'c']);
  });
});
