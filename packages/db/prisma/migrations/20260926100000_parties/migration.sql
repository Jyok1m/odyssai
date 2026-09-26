-- Une histoire jouee a plusieurs : une table, un monde, une conversation.

-- Le joueur qui incarne ce personnage. Recopie depuis le proprietaire du
-- monde : les fiches existantes restent a qui elles etaient, et les nouvelles
-- d'une partie se posent a leur joueur.
ALTER TABLE "characters" ADD COLUMN "owner_id" UUID;
ALTER TABLE "characters" ADD CONSTRAINT "characters_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "characters" c SET "owner_id" = u."owner_id"
  FROM "universes" u
  WHERE c."universe_id" = u."id" AND u."owner_id" IS NOT NULL;

-- L'unicite demenage de l'univers a la paire : un personnage par joueur et
-- par univers, plusieurs joueurs par univers. Les nuls restent distincts
-- entre eux, donc les orphelins ne se genent pas.
DROP INDEX "characters_universe_id_key";
CREATE UNIQUE INDEX "characters_universe_id_owner_id_key"
  ON "characters"("universe_id", "owner_id");

-- La table elle-meme, attachee a l'histoire qu'on y joue.
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "universe_id" UUID NOT NULL,
    "size" INTEGER NOT NULL,
    "invite_code" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parties_universe_id_key" ON "parties"("universe_id");
CREATE UNIQUE INDEX "parties_invite_code_key" ON "parties"("invite_code");
ALTER TABLE "parties" ADD CONSTRAINT "parties_universe_id_fkey"
  FOREIGN KEY ("universe_id") REFERENCES "universes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Un siege par joueur, et ce qui lui appartient en propre : son inspiration
-- et son avancee.
CREATE TABLE "party_members" (
    "id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "works" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "party_members_user_id_key" ON "party_members"("user_id");
CREATE INDEX "party_members_party_id_idx" ON "party_members"("party_id");
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Le membre auquel un message appartient : un fil de creation par membre,
-- et dans le journal du jeu, qui a parle. Le rang reste unique par
-- (univers, canal) : un seul compteur par canal, les fils le lisent filtre.
ALTER TABLE "conversation_messages" ADD COLUMN "member_id" UUID;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "conversation_messages_universe_id_channel_member_id_idx"
  ON "conversation_messages"("universe_id", "channel", "member_id");

-- Le membre dont c'est le tour : son jet, sa fiche, ses degats. Pour rendre a
-- chacun son dernier de, et relire a qui appartient un verdict.
ALTER TABLE "turns" ADD COLUMN "member_id" UUID;
ALTER TABLE "turns" ADD CONSTRAINT "turns_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "turns_universe_id_member_id_idx" ON "turns"("universe_id", "member_id");
