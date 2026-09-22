import { describe, expect, it } from 'vitest';
import { isClean, normalizeForModeration, screenText } from '@odyssai/engine';

describe('moderation lexicale', () => {
  it('laisse passer un texte ordinaire', () => {
    expect(isClean("J'ouvre la porte et je regarde le puits.")).toBe(true);
    expect(isClean('Je reconnais ce visage, mais je ne sais plus ou.')).toBe(true);
  });

  it('attrape une insulte nue', () => {
    expect(isClean('espece de connard')).toBe(false);
  });

  // Sans normalisation, chacun de ces procedes suffirait a passer.
  it('defait les deguisements', () => {
    for (const text of ['c0nn4rd', 'c.o.n.n.a.r.d', 'CONNAAAARD', 'çonnard']) {
      expect(isClean(text)).toBe(false);
    }
  });

  it('attrape les accords', () => {
    expect(isClean('bande de connards')).toBe(false);
    expect(isClean('les salopes')).toBe(false);
  });

  /*
    Le vrai danger de cette couche. Chacune de ces phrases a ete refusee par
    une version anterieure, et chacune est du francais parfaitement ordinaire.
  */
  it.each([
    'je reconnais le lieu',
    'la reconnaissance du territoire',
    'il faut reconnecter le puits',
    'le batardeau retient l eau du canal',
    'la fagotiere brule mal',
    'le fagot de bois sec',
    'la salopette du mineur',
    'il retarde son depart',
    'une retardataire arrive',
    'du fromage rape',
    'le putois traverse la route',
    'une tapisserie ancienne',
    'le negociant refuse de vendre',
    'la reputation du marchand est faite',
  ])('laisse passer : %s', (text) => {
    expect(isClean(text)).toBe(true);
  });

  // Quatre lettres isolees de suite ne sont pas une phrase : c'est la
  // signature d'un contournement.
  it('attrape un mot epele', () => {
    expect(isClean('c o n n a r d')).toBe(false);
    expect(isClean('f.u.c.k.i.n.g idiot')).toBe(false);
  });

  it('ne prend pas quatre lettres innocentes pour un mot epele', () => {
    expect(isClean('j ai vu a b c d sur le mur')).toBe(true);
  });

  it('ne rend jamais le mot au joueur, seulement la raison', () => {
    const hits = screenText('connard');
    expect(hits[0]!.reason).toBe('slur');
  });

  it('normalise de facon stable', () => {
    expect(normalizeForModeration('Ça  va, Élodie ?')).toBe('ca va elodie');
  });
});
