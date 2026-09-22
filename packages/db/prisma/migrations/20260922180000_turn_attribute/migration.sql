-- Ce que la fiche a pese sur un jet.
--
-- Facultatives et par defaut nulles : l'ancienne image, qui ne les ecrit pas,
-- continue de tourner sur ce schema pendant la bascule.
ALTER TABLE "turns"
  ADD COLUMN "modifier" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attribute" VARCHAR(16);
