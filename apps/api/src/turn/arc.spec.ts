import { describe, expect, it } from 'vitest';
import { TURN_PROMPT } from '@odyssai/narrator';
import type { WorldArc } from '@odyssai/schemas';

const ARC: WorldArc = {
  hook: 'Le puits du hameau est a sec depuis trois jours.',
  stakes: 'Sans eau, le hameau se videra avant la fin du mois.',
  acts: [
    { goal: 'Comprendre ce qui a tari le puits.', done: 'La galerie est trouvee.' },
    { goal: 'Savoir qui a detourne la nappe.', done: 'Le nom est connu.' },
    { goal: 'Rendre l eau au hameau.', done: 'Le puits coule de nouveau.' },
  ],
};

const CONTEXT = {
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
  guidance: [],
  inventory: [],
  asking: false,
  mustUseDie: false,
  fate: false,
  opening: false,
};

const system = (extra: Record<string, unknown>) =>
  TURN_PROMPT.build('fr', { ...CONTEXT, ...extra } as never, 'je cherche')[0]!
    .content;

describe("l'histoire donnee au meneur", () => {
  it("porte l'acte en cours", () => {
    const content = system({ arc: ARC, act: 1 });
    expect(content).toContain('acte 1 sur 3');
    expect(content).toContain('La galerie est trouvee.');
  });

  /*
    Le point qui compte : un meneur qui lirait la fin y menerait tout droit,
    et le joueur n'aurait plus qu'a suivre. Une histoire qui sait ou elle va
    se raconte, elle ne se joue pas.
  */
  it("ne montre jamais les actes suivants", () => {
    const content = system({ arc: ARC, act: 1 });
    expect(content).not.toContain('Le nom est connu.');
    expect(content).not.toContain('Le puits coule de nouveau.');
  });

  it('avance avec le joueur', () => {
    const content = system({ arc: ARC, act: 2 });
    expect(content).toContain('acte 2 sur 3');
    expect(content).toContain('Le nom est connu.');
    expect(content).not.toContain('La galerie est trouvee.');
  });

  // Au dela du dernier acte, la partie continue sans but donne.
  it('passe en aventure libre une fois le dernier acte clos', () => {
    const content = system({ arc: ARC, act: 4 });
    expect(content).toContain('terminee');
    expect(content).not.toContain('acte 4');
    expect(content).not.toContain('Le puits coule de nouveau.');
  });

  /*
    Un monde genere avant l'arc n'en a pas, et sa partie doit rester jouable :
    sans bloc, le meneur joue comme il jouait.
  */
  it('ne pose aucun bloc sans histoire', () => {
    expect(system({})).not.toContain('<histoire>');
    expect(system({ arc: ARC })).not.toContain('<histoire>');
  });
});
