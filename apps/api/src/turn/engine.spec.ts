import { describe, expect, it } from 'vitest';
import {
  DIE_FACES,
  OUTCOME_BANDS,
  arbitrateCanon,
  attributeFor,
  bandFor,
  bandOf,
  modifierOf,
  creditsFor,
  publicOutcome,
  rollD20,
  settledByDie,
} from '@odyssai/engine';
import type { CanonFact, WorldCharter } from '@odyssai/schemas';

const CHARTER: WorldCharter = {
  premise: 'Un desert que l on traverse en achetant son eau a chaque etape.',
  tone: 'Sec, patient, sans merveilleux.',
  allowed: ['lire le vent', 'sceller un pacte par le sel'],
  forbidden: ['aucune arme a feu dans ce monde', 'aucune resurrection des morts'],
  narratorRules: ['nommer la soif avant la peur', 'ne jamais promettre la pluie'],
};

const fact = (subject: string, statement: string): CanonFact => ({
  subject,
  statement,
});

describe('le de', () => {
  it('ne sort jamais du de', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const roll = rollD20();
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(DIE_FACES);
    }
  });

  // Sans etre un test statistique : un biais grossier se verrait ici.
  it('couvre les vingt faces sur dix mille jets', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) seen.add(rollD20());
    expect(seen.size).toBe(DIE_FACES);
  });

  it('isole le 1 et le 20 dans leur propre bande', () => {
    expect(bandOf(1)).toBe('echec_critique');
    expect(bandOf(2)).toBe('echec');
    expect(bandOf(19)).toBe('succes');
    expect(bandOf(20)).toBe('succes_critique');
  });

  it('couvre toutes les faces sans trou ni bande inconnue', () => {
    const bands = Array.from({ length: DIE_FACES }, (_, i) => bandOf(i + 1));
    expect(bands).toHaveLength(DIE_FACES);
    for (const band of bands) expect(OUTCOME_BANDS).toContain(band);
  });

  it('refuse un jet hors du de', () => {
    expect(() => bandOf(0)).toThrow(RangeError);
    expect(() => bandOf(21)).toThrow(RangeError);
    expect(() => bandOf(3.5)).toThrow(RangeError);
  });

  // Le joueur obtient quelque chose sur un partiel : c'est favorable, et la
  // nuance appartient au recit.
  it('ne montre que deux etats, partiel compris comme favorable', () => {
    expect(publicOutcome('echec_critique')).toBe('defavorable');
    expect(publicOutcome('echec')).toBe('defavorable');
    expect(publicOutcome('partiel')).toBe('favorable');
    expect(publicOutcome('succes')).toBe('favorable');
    expect(publicOutcome('succes_critique')).toBe('favorable');
  });
});

describe('arbitrage du canon', () => {
  it('accepte un fait qui ne heurte rien', () => {
    const verdict = arbitrateCanon(
      [fact('les puits du nord', 'On y paie l eau en sel, jamais en metal.')],
      CHARTER,
      ['Dune'],
    );

    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.rejected).toHaveLength(0);
  });

  /*
    Le canon nourrit tous les tours suivants : un interdit franchi une fois ne
    se referme plus, d'ou un refus plutot qu'un avertissement.
  */
  it('refuse un fait qui contredit un interdit de la charte', () => {
    const verdict = arbitrateCanon(
      [fact('la garde', 'La garde porte une arme a feu depuis la derniere crue.')],
      CHARTER,
      [],
    );

    expect(verdict.accepted).toHaveLength(0);
    expect(verdict.rejected[0]!.verdict.reason).toBe('forbidden');
  });

  it('refuse un fait qui emprunte un nom a une oeuvre citee', () => {
    const verdict = arbitrateCanon(
      [fact('un voyageur', 'On raconte que Arrakis fut son premier desert.')],
      CHARTER,
      ['Arrakis'],
    );

    expect(verdict.accepted).toHaveLength(0);
    expect(verdict.rejected[0]!.verdict.reason).toBe('borrowed');
  });

  // Un mot isole ne suffit pas : sinon toute phrase parlant d eau tomberait.
  it('ne refuse pas sur un seul mot en commun', () => {
    const verdict = arbitrateCanon(
      [fact('un rite', 'On veille les morts trois nuits avant de les rendre au froid.')],
      CHARTER,
      [],
    );

    expect(verdict.accepted).toHaveLength(1);
  });

  it('trie, plutot que de tout jeter pour un fait fautif', () => {
    const verdict = arbitrateCanon(
      [
        fact('les puits', 'Ils se scellent au sel avant chaque nuit.'),
        fact('la garde', 'Elle porte une arme a feu depuis peu.'),
      ],
      CHARTER,
      [],
    );

    expect(verdict.accepted).toHaveLength(1);
    expect(verdict.rejected).toHaveLength(1);
  });
});

/*
  L'usage du de appartient au code, comme son lancer. Mesure sur douze tours,
  le modele ne s'en servait qu'une fois et racontait une reussite sur une
  bande d'echec : lui laisser juger de l'incertitude revenait a lui laisser
  le de.
*/
describe('ce qui se tranche au de', () => {
  it('tranche un geste qui peut rater', () => {
    for (const situation of ['violence', 'contrainte', 'tromperie', 'entreprise']) {
      expect(settledByDie(situation), situation).toBe(true);
    }
  });

  it('ne tranche pas ce qui ne se rate pas', () => {
    for (const situation of ['lore', 'meta', 'attente', 'intimite', 'exploration']) {
      expect(settledByDie(situation), situation).toBe(false);
    }
  });

  // Verdict illisible, etiquette inconnue, ouverture : rien a trancher.
  it('ne tranche rien sans situation', () => {
    expect(settledByDie(null)).toBe(false);
  });
});

/*
  Une question au meneur a son propre curseur : c'est le meme appel qu'un
  tour, mais le facturer plein tarif decouragerait exactement ce qu'on veut
  encourager, un joueur qui demande plutot qu'un joueur qui subit.
*/
describe('ce qu une question coute', () => {
  it('a son entree au bareme', () => {
    expect(creditsFor('question')).toBeGreaterThanOrEqual(0);
  });

  it('ne coute pas plus qu un tour', () => {
    expect(creditsFor('question')).toBeLessThanOrEqual(creditsFor('turn'));
  });
});

/*
  La fiche pese sur le jet, et c'est le code qui decide combien : demander au
  modele quel attribut s'applique reviendrait a le laisser choisir le plus
  haut de la fiche.
*/
describe('ce que la fiche pese', () => {
  it('donne un modificateur de -2 a +2', () => {
    expect(modifierOf(1)).toBe(-2);
    expect(modifierOf(3)).toBe(0);
    expect(modifierOf(5)).toBe(2);
  });

  it('teste un attribut pour chaque situation qui tranche', () => {
    expect(attributeFor('violence')).toBe('corps');
    expect(attributeFor('tromperie')).toBe('adresse');
    expect(attributeFor('entreprise')).toBe('esprit');
    expect(attributeFor('contrainte')).toBe('presence');
  });

  it("n'en teste aucun quand rien ne tranche", () => {
    for (const situation of ['lore', 'meta', 'attente', null]) {
      expect(attributeFor(situation), String(situation)).toBeNull();
    }
  });

  /*
    Le total est borne aux faces plutot que de deborder : `bandOf` refuse ce
    qui n'est pas un jet valide, et c'est bien qu'elle le refuse.
  */
  it('borne le total aux faces du de', () => {
    expect(() => bandFor(20, 2)).not.toThrow();
    expect(() => bandFor(1, -2)).not.toThrow();
    expect(bandFor(20, 2)).toBe('succes_critique');
    expect(bandFor(1, -2)).toBe('echec_critique');
  });

  // Une force et une faiblesse doivent pouvoir decider d'un bord.
  it('fait basculer un jet limite', () => {
    expect(bandFor(14, 0)).toBe('partiel');
    expect(bandFor(14, 2)).toBe('succes');
    expect(bandFor(10, 0)).toBe('partiel');
    expect(bandFor(10, -2)).toBe('echec');
  });
});
