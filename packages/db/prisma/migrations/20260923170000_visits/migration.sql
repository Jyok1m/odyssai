-- Une visite est une histoire qui emprunte son monde.
--
-- Elle a ses tours, ses entites, son canon et son personnage ; elle n'a
-- simplement pas de monde a elle. Sa charte, sa bible et les habitants
-- qu'elle lit sont ceux de l'hote. C'est ce qui permet de jouer chez un
-- autre sans jamais ecrire dans son etat, et ce qui evite d'avoir deux
-- boucles de tour a tenir.
ALTER TABLE "universes" ADD COLUMN "visiting_id" UUID;

CREATE INDEX "universes_visiting_id_idx" ON "universes" ("visiting_id");

-- Cascade, et la cascade est hors d'atteinte : une rencontre est ecrite des
-- la premiere visite, et c'est elle qui garde le monde de l'hote au moment ou
-- il part.
ALTER TABLE "universes"
  ADD CONSTRAINT "universes_visiting_id_fkey"
  FOREIGN KEY ("visiting_id") REFERENCES "universes" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
