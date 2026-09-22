import { describe, expect, it } from 'vitest';
import { GUIDANCE, TURN_PROMPT } from '@odyssai/narrator';
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
      SITUATIONS.flatMap((situation) =>
        GUIDANCE.for(situation, 'fr').map((card) => card.id),
      ),
    );

    const unreachable = GUIDANCE.cards
      .filter((card) => !served.has(card.id))
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

    expect(fr?.id).toBe(en?.id);
    expect(fr?.text).toContain('fiction');
    expect(en?.text).toContain('fiction');
    expect(fr?.text).not.toBe(en?.text);
  });
});

/*
  Le branchement lui-meme : ce que le meneur recoit vraiment. Le bloc n'existe
  que lorsqu'une fiche a ete retenue, sinon le prompt est celui d'avant ce
  corpus, au mot pres.
*/
describe('rappels dans le prompt du meneur', () => {
  const context = {
    charter: {
      premise: 'p',
      tone: 't',
      allowed: ['a', 'b'],
      forbidden: ['c', 'd'],
      narratorRules: ['e', 'f'],
    },
    bible: {} as never,
    character: {} as never,
    canon: [],
    recent: [],
    recalled: [],
    band: 'partiel',
    asking: false,
    mustUseDie: false,
    fate: false,
    opening: false,
  };

  const system = (guidance: string[]) =>
    TURN_PROMPT.build('fr', { ...context, guidance }, 'je frappe')[0]!.content;

  /*
    La balise ouvrante du bloc, et non la mention que les consignes en font :
    elles parlent de <rappels> a chaque tour, bloc ou pas.
  */
  const OPENS = '<rappels>\n';

  it('pose le bloc quand une fiche a ete retenue', () => {
    const content = system(
      GUIDANCE.for('violence', 'fr').map((card) => card.text),
    );

    expect(content).toContain(OPENS);
    expect(content).toContain('Un affrontement ne se compte pas en points');
  });

  it('ne pose aucun bloc sans fiche', () => {
    expect(system([])).not.toContain(OPENS);
  });

  /*
    Le bloc arrive apres le de, donc apres tout ce qui ne change pas d'un tour
    a l'autre : le cache de prompt du fournisseur n'a rien a y perdre.
  */
  it('place le bloc apres le de', () => {
    const content = system(['rappel']);
    expect(content.indexOf(OPENS)).toBeGreaterThan(content.indexOf('<de>\n'));
  });
});
