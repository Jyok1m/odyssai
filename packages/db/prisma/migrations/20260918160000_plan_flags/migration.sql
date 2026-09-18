-- Deux etats d'un palier que le tableau de bord doit pouvoir poser.
--
-- `recommended` designe le palier mis en avant. C'etait jusqu'ici un calcul,
-- « celui du milieu parmi les payants » : juste tant qu'il y en a trois, faux
-- des qu'on en ajoute un, et surtout hors de portee de qui edite les paliers.
--
-- `coming_soon` retire un palier de la vente sans le retirer de la page. Un
-- palier archive disparait ; celui-la s'annonce. Il se distingue d'un palier
-- sans prix Stripe, qui n'est pas vendable faute de configuration : ici c'est
-- une decision, pas un manque.
ALTER TABLE "plans" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "coming_soon" BOOLEAN NOT NULL DEFAULT false;

-- Un seul palier recommande a la fois : l'index partiel le garantit en base
-- plutot que dans le service, ou deux ecritures concurrentes passeraient.
CREATE UNIQUE INDEX "plans_recommended_key" ON "plans" ("recommended") WHERE "recommended";

UPDATE "plans" SET "recommended" = true, "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'traveler';
