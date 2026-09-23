-- L'alpha ouvre pour tout le monde. Plus de porte a cent places : les cent
-- premiers gardent leur bonus, les suivants entrent quand meme. Le jeu est
-- ouvert des ce deploiement, et le tableau de bord garde l'interrupteur pour
-- une maintenance ou une remise a zero.
--
-- La vente des paliers, elle, est fermee le temps de l'alpha : tout le monde
-- joue sur le palier libre. Elle s'ouvre au tableau de bord, un matin.
ALTER TABLE "site_settings" ADD COLUMN "sales_open" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "site_settings" ALTER COLUMN "alpha_phase" SET DEFAULT 'open';
UPDATE "site_settings" SET "alpha_phase" = 'open';
