import { randomInt } from 'node:crypto';
import { NAME_PALETTES, STORY_REGISTERS, type Flavour } from '@odyssai/schemas';

/*
  Le registre et la palette d'un monde, tires avant sa generation.

  Par le code et non par le modele : laisse choisir, il choisit toujours la
  meme chose, le complot et les memes prenoms. `randomInt` comme pour le de,
  sans biais modulo. Tire une fois par travail, et garde dans l'etat du
  graphe : une reprise ne retire pas.
*/
export function drawFlavour(): Flavour {
  return {
    register: STORY_REGISTERS[randomInt(STORY_REGISTERS.length)]!,
    palette: NAME_PALETTES[randomInt(NAME_PALETTES.length)]!,
  };
}
