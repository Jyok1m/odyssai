-- Founder cesse d'etre un palier pour devenir un bonus.
--
-- Un palier se choisit ; celui-la ne se choisissait pas, il s'attribuait aux
-- cent premiers inscrits. Le faire vivre dans `plans` obligeait la page de
-- tarifs a montrer une offre que personne ne pouvait prendre, et le catalogue
-- a la servir a tout le monde. Le rang d'inscription n'est pas un palier :
-- c'est une propriete du compte, et le bonus s'ecrit au grand livre comme
-- n'importe quelle attribution.

-- Personne ne le porte, la colonne venant d'etre creee, mais la cle etrangere
-- refuserait la suppression si quelqu'un l'avait recu entre-temps.
UPDATE "subscriptions" SET "plan" = 'free' WHERE "plan" = 'founder';
DELETE FROM "plans" WHERE "slug" = 'founder';

-- Rider passe a cinquante credits : deux mondes, ou un monde et vingt-cinq
-- tours. A trente il restait cinq tours apres la naissance du monde, de quoi
-- voir la porte et pas la piece.
UPDATE "plans"
   SET "welcome_credits" = 50,
       "sort_order" = 0,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "slug" = 'free';

UPDATE "plans" SET "sort_order" = 1, "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'player';
UPDATE "plans" SET "sort_order" = 2, "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'traveler';
UPDATE "plans" SET "sort_order" = 3, "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'dreamer';
