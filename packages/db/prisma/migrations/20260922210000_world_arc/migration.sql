-- L'histoire dans laquelle le heros est parachute.
--
-- L'etape du graphe d'abord : `ALTER TYPE ... ADD VALUE` ne peut pas tourner
-- dans la meme transaction que ce qui s'en sert, mais rien ici ne s'en sert.
ALTER TYPE "generation_step" ADD VALUE IF NOT EXISTS 'arc' BEFORE 'validation';

-- Ou en est l'histoire. Nul pour un monde genere avant l'arc : sans arc, le
-- meneur joue comme il jouait, et rien ne doit le forcer a faire autrement.
ALTER TABLE "universes" ADD COLUMN "arc_act" INTEGER;
