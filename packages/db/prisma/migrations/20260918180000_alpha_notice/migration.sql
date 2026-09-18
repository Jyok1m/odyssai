-- L'etat de l'alpha, tel que le site l'annonce.
--
-- Une table a une seule ligne, et non une variable d'environnement : passer de
-- la pre-inscription a l'ouverture est une decision qui se prend un matin, pas
-- un deploiement. Meme raison que pour les paliers.
--
-- La phase est un choix ; « complete » n'en est pas un, c'est le constat que
-- les cent places sont prises. L'administrateur decide de ce qu'on annonce,
-- pas de ce qui est vrai.
CREATE TABLE "site_settings" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "alpha_phase" VARCHAR(16) NOT NULL DEFAULT 'preregistration',
    "alpha_notice" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id"),
    -- La cle primaire vaut toujours vrai : la table ne peut porter qu'une
    -- ligne, et personne n'aura a se demander laquelle est la bonne.
    CONSTRAINT "site_settings_singleton" CHECK ("id")
);

INSERT INTO "site_settings" ("id") VALUES (true);
