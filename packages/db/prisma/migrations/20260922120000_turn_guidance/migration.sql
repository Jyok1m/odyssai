-- Ce que le classificateur a lu, et ce que le meneur a recu en retour.
--
-- Les deux colonnes sont facultatives et l'ancienne version de l'api, qui ne
-- les ecrit pas, continue de tourner sur ce schema pendant la bascule des
-- images : une migration passe avant les conteneurs, jamais avec eux.
ALTER TABLE "turns"
  ADD COLUMN "situation" VARCHAR(24),
  ADD COLUMN "guidance" TEXT[] DEFAULT ARRAY[]::TEXT[];
