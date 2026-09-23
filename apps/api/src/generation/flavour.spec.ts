import { describe, expect, it } from 'vitest';
import { drawFlavour } from '@odyssai/engine';
import { FlavourSchema, overusedNamesIn } from '@odyssai/schemas';

/*
  Les prenoms que tous les modeles donnent a tout le monde, et le tirage qui
  impose au modele un registre et une couleur de noms : c'est le code qui
  decide de ce qui distingue un monde du suivant.
*/
describe('des mondes qui ne se ressemblent pas', () => {
  it('reconnait un prenom ou un mot de groupe trop vu, sur des mots entiers replies', () => {
    expect(
      overusedNamesIn(['Kaelen Voss', 'Mira', 'Le Syndicat du Vert', 'Tomas', 'Élara', 'Kaelenne']),
    ).toEqual(['Kaelen Voss', 'Mira', 'Le Syndicat du Vert', 'Élara']);
  });

  it('tire un registre et une palette que le schema accepte', () => {
    const drawn = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const flavour = drawFlavour();
      expect(FlavourSchema.safeParse(flavour).success).toBe(true);
      drawn.add(`${flavour.register}/${flavour.palette}`);
    }
    // Quarante tirages sans jamais varier serait un tirage cassé.
    expect(drawn.size).toBeGreaterThan(1);
  });
});
