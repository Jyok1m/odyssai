-- Ce qu'on rapporte d'un monde : une cicatrice, une peur, une conviction.
-- Sur l'essence et non sur l'incarnation, parce que c'est ce qui traverse.
ALTER TABLE "essences" ADD COLUMN "marks" JSONB NOT NULL DEFAULT '[]';

-- Un monde accepte-t-il des visiteurs. Faux par defaut : il appartient a son
-- createur tant qu'il n'a pas dit le contraire, et personne ne peut encore
-- franchir une faille vers le monde d'un autre de toute facon.
ALTER TABLE "universes" ADD COLUMN "is_open" BOOLEAN NOT NULL DEFAULT false;
