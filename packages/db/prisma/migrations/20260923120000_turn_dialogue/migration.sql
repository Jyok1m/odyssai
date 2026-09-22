-- La replique jouee par le modele de dialogue, quand le joueur s'adresse a
-- un personnage : qui a parle, et ce qu'il a dit.
ALTER TABLE "turns" ADD COLUMN "speaker" VARCHAR(80);
ALTER TABLE "turns" ADD COLUMN "line" TEXT;
