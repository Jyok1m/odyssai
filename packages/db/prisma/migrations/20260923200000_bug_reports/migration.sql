-- Les bugs signales depuis le jeu, avec leur capture.
--
-- La capture est en base et non sur disque : un conteneur n'a pas de disque
-- qui survive a son remplacement, et cent joueurs d'alpha ne remplissent pas
-- une table. Elle se sert a part, par son identifiant, jamais dans la liste.
--
-- Le joueur est detache s'il part (SET NULL) : le rapport reste lisible,
-- sans personne derriere.
CREATE TABLE "bug_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "page" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "user_agent" VARCHAR(400) NOT NULL,
    "screenshot" BYTEA,
    "screenshot_type" VARCHAR(40),
    -- Quand l'administrateur l'a marque traite. Nul tant qu'il ne l'est pas.
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- La liste se lit du plus recent au plus ancien, et le compte de ce qui reste
-- a traiter se prend sur le meme index.
CREATE INDEX "bug_reports_handled_at_created_at_idx"
    ON "bug_reports" ("handled_at", "created_at" DESC);

ALTER TABLE "bug_reports"
    ADD CONSTRAINT "bug_reports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
