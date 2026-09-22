-- Ce que le joueur a envoye, a cote de ce que le modele en a fait.
ALTER TABLE "turns" ADD COLUMN "request" VARCHAR(8);
