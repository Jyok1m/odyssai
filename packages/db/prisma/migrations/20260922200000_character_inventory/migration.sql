-- Ce que le personnage porte.
--
-- Des noms et rien d'autre : un objet n'a pas d'effet chiffre. Le meneur le
-- raconte, le moteur ne le calcule pas, sinon l'etat du jeu se deciderait dans
-- la prose.
ALTER TABLE "characters"
  ADD COLUMN "inventory" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
