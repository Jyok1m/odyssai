-- Le consentement a recevoir des nouvelles.
--
-- Deux colonnes et non une : un consentement se prouve, et prouver demande une
-- date. `marketing_opt_in_at` porte l'instant du dernier changement, quel que
-- soit le sens. Un retrait se lit alors aussi bien qu'un accord, ce qui est
-- exactement ce qu'on veut pouvoir montrer.
--
-- Faux par defaut, et personne ne le bascule a la place du joueur : un opt-in
-- pre-coche n'est pas un consentement.
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "marketing_opt_in_at" TIMESTAMPTZ(3);

-- L'extraction ne lit que ceux qui ont dit oui, et elle le fait souvent quand
-- on prepare un envoi : l'index partiel ne porte que ces lignes la.
CREATE INDEX "users_marketing_opt_in_idx" ON "users" ("marketing_opt_in") WHERE "marketing_opt_in";
