-- Le socle chiffre remplace le dictionnaire a cles libres.
--
-- Les cles que le modele inventait etaient des competences et non des
-- attributs : une fiche portait « Kendo », « Tir a l'arc », « Discretion ».
-- Elles deviennent donc des talents, ou elles ont leur place, et le socle part
-- au milieu de l'echelle.
--
-- Sans cette conversion, `CharacterSheetSchema` refuserait la fiche, donc
-- `TurnMemoryService.world()` rendrait null, donc la partie deviendrait
-- injouable : le schema strict est relu a chaque tour.
ALTER TABLE "characters"
  ADD COLUMN "talents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "characters"
SET
  -- Les anciennes cles partent en talents, dans l'ordre ou elles etaient.
  "talents" = ARRAY(
    SELECT key FROM jsonb_object_keys("attributes"::jsonb) AS key LIMIT 6
  ),
  "attributes" = jsonb_build_object(
    'corps', 3, 'adresse', 3, 'esprit', 3, 'presence', 3, 'instinct', 3
  )
WHERE "attributes" IS NOT NULL
  AND NOT ("attributes"::jsonb ?& array['corps', 'adresse', 'esprit', 'presence', 'instinct']);
