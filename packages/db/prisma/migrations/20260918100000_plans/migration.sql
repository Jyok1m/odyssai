-- Les plans passent du code a la base : une dotation ne doit pas demander un
-- deploiement pour bouger. Le tableau de bord d'administration les edite.

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(24) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "monthly_credits" INTEGER NOT NULL,
    "welcome_credits" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'eur',
    "stripe_product_id" TEXT,
    "stripe_price_id" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_price_id_key" ON "plans"("stripe_price_id");

-- CreateIndex
CREATE INDEX "plans_archived_sort_order_idx" ON "plans"("archived", "sort_order");

-- Les trois paliers qui vivaient dans packages/engine, repris a l'identique.
-- Cet amorcage est dans la migration et non dans un script : la cle etrangere
-- ajoutee juste apres echouerait sur les abonnements deja en base, et une
-- migration qui laisse la base invalide entre deux commandes n'en est pas une.
INSERT INTO "plans"
  ("id", "slug", "name", "monthly_credits", "welcome_credits",
   "amount_cents", "currency", "archived", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'free',      'Libre',     30,   25, NULL, 'eur', false, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'apprenti',  'Apprenti',  300,  0,  NULL, 'eur', false, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'arpenteur', 'Arpenteur', 1000, 0,  NULL, 'eur', false, 2, CURRENT_TIMESTAMP);

-- Un abonnement dont le plan ne serait dans aucun palier connu est une donnee
-- qu'aucun code ne sait lire : il retombe au palier libre plutot que de bloquer
-- la migration. Aucune ligne n'est concernee aujourd'hui, la valeur venant
-- d'une enumeration fermee.
UPDATE "subscriptions"
   SET "plan" = 'free'
 WHERE "plan" NOT IN (SELECT "slug" FROM "plans");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_fkey" FOREIGN KEY ("plan") REFERENCES "plans"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
