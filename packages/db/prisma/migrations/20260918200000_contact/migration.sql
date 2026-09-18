-- Les messages du formulaire de contact.
--
-- Ecrits en base avant d'etre envoyes par courriel, et non l'inverse : un
-- serveur de messagerie qui refuse ne doit pas faire perdre le message de
-- quelqu'un qui a pris le temps de l'ecrire. `delivered` dit si le courriel
-- est parti ; le tableau de bord les lit dans tous les cas.
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80),
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(120) NOT NULL,
    "message" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    -- Quand l'administrateur l'a marque traite. Nul tant qu'il ne l'est pas.
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- La liste se lit du plus recent au plus ancien, et le compte de ce qui reste
-- a traiter se prend sur le meme index.
CREATE INDEX "contact_messages_handled_at_created_at_idx"
    ON "contact_messages" ("handled_at", "created_at" DESC);
