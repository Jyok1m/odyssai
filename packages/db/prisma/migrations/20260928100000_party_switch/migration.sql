-- Le jeu a plusieurs derriere un interrupteur, comme la vente des paliers :
-- la feature reste entiere en base et en code, seules ses deux entrees se
-- refusent tant que la colonne est fausse. Fermee par defaut, elle s'ouvre au
-- tableau de bord, sans deploiement.
ALTER TABLE "site_settings" ADD COLUMN "party_open" BOOLEAN NOT NULL DEFAULT false;
