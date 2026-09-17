-- Quelques majuscules Unicode s'abaissent en deux points de code, donc le
-- pseudo replie peut depasser la longueur du pseudo lui-meme.
ALTER TABLE "users" ALTER COLUMN "username_folded" SET DATA TYPE VARCHAR(64);
