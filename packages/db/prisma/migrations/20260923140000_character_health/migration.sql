-- Les points de vie, tenus par le code.
--
-- `hp` reste nul pour les personnages existants, et nul vaut la reserve
-- pleine : le maximum derive de `corps`, qui vit dans un JSON, et le remplir
-- ici aurait demande de le lire en SQL pour poser une valeur que le premier
-- coup recu ecrit de toute facon. Une migration doit rester lisible par la
-- version qu'elle remplace, et celle-ci l'est : l'ancienne api ignore ces
-- deux colonnes.
ALTER TABLE "characters" ADD COLUMN "hp" INTEGER;

-- Tours calmes depuis le dernier point rendu. Il n'y a pas d'horloge dans ce
-- jeu : le repos se compte en tours.
ALTER TABLE "characters" ADD COLUMN "rest" INTEGER NOT NULL DEFAULT 0;
