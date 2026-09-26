-- Le membre dont le tour a fait naitre un fait de canon, dans une table. Nul
-- en solo, et apres l'effacement de son compte : le fait reste au monde.
ALTER TABLE "canon_facts" ADD COLUMN "member_id" UUID;
ALTER TABLE "canon_facts" ADD CONSTRAINT "canon_facts_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
