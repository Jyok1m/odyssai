-- Ce que le monde sait, entite par entite : ce que le joueur a appris, et ce
-- que le meneur garde. Semees par la generation, puis nees en jeu.
CREATE TABLE "entities" (
  "id"          UUID NOT NULL,
  "universe_id" UUID NOT NULL,
  "kind"        VARCHAR(8) NOT NULL,
  "name"        VARCHAR(80) NOT NULL,
  "key"         VARCHAR(80) NOT NULL,
  "known"       TEXT NOT NULL,
  "hidden"      TEXT,
  "revealed_at" TIMESTAMPTZ(3),
  "seq"         INTEGER,
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entities_universe_id_key_key" ON "entities"("universe_id", "key");

ALTER TABLE "entities"
  ADD CONSTRAINT "entities_universe_id_fkey"
  FOREIGN KEY ("universe_id") REFERENCES "universes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
