-- Les jets depuis la derniere montee, un compteur par attribut.
--
-- Nullable et sans defaut : un personnage d'avant cette colonne n'a pas
-- d'historique de progression, et repartir de zero est la bonne reponse.
ALTER TABLE "characters" ADD COLUMN "progress" JSONB;
