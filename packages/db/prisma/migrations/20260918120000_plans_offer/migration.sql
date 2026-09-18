-- Les cinq paliers de l'alpha, en remplacement des trois amorces.
--
-- Dans une migration et non a la main au tableau de bord : les deux copies du
-- site ont chacune leur base, et une ligne posee sur l'une ne se retrouve pas
-- sur l'autre. C'est aussi ce qui fait que la production, qui n'a pas encore
-- la table, recevra la table puis l'offre en un seul deploiement.
--
-- Les montants sont poses sans identifiant de prix Stripe : ils s'affichent,
-- mais `purchasable` reste faux et l'ecran cache l'offre plutot que d'offrir
-- un bouton qui repondrait 503. La mise en vente se fait au tableau de bord,
-- qui cree le produit et le prix avec une cle d'idempotence derivee du slug.

-- Rider garde le slug `free`. C'est FREE_PLAN_SLUG, le palier sur lequel tout
-- abonnement resilie retombe, et celui que la table protege de l'archivage.
-- Le slug est technique, le nom est ce que le joueur lit : les separer est
-- precisement ce que la colonne `name` permet.
--
-- Sa dotation mensuelle tombe a zero et la bienvenue passe a 30 : le palier
-- libre se decouvre puis se rachete. Le roulement de periode remet la reserve
-- a `monthly_credits`, donc a rien, ce qui est le comportement voulu.
UPDATE "plans"
   SET "name" = 'Rider',
       "monthly_credits" = 0,
       "welcome_credits" = 30,
       "sort_order" = 1,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "slug" = 'free';

-- Founder n'est pas un palier qu'on choisit : il se recoit. Les cent premiers
-- inscrits l'ont a la place de Rider, avec cinquante credits de plus, de quoi
-- generer un monde et jouer cinquante-cinq tours au lieu de cinq.
INSERT INTO "plans"
  ("id", "slug", "name", "monthly_credits", "welcome_credits",
   "amount_cents", "currency", "archived", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'founder',  'Founder',  0,    80, NULL, 'eur', false, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'player',   'Player',   300,  0,  499,  'eur', false, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'traveler', 'Traveler', 600,  0,  799,  'eur', false, 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'dreamer',  'Dreamer',  1500, 0,  1999, 'eur', false, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Les deux paliers d'amorcage n'ont jamais ete mis en vente : aucun prix
-- Stripe ne leur est attache, personne ne les porte. Un abonnement qui les
-- porterait malgre tout retombe au palier libre avant la suppression, sans
-- quoi la cle etrangere de `subscriptions.plan` la refuserait et laisserait la
-- migration a moitie faite.
UPDATE "subscriptions"
   SET "plan" = 'free'
 WHERE "plan" IN ('apprenti', 'arpenteur');

DELETE FROM "plans" WHERE "slug" IN ('apprenti', 'arpenteur');
