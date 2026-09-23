-- La chronique des voyageurs : ce qu'une visite laisse dans un monde, et que
-- son createur valide ou refuse.
--
-- C'est le seul chemin par lequel une visite atteint le monde de l'hote. Elle
-- ecrit chez elle, toujours ; ce qu'elle propose ne devient vrai la-bas que
-- lorsque celui a qui ce monde appartient le decide.
--
-- NULL veut dire « pas encore relu ». Une histoire ordinaire garde NULL pour
-- toujours : on ne valide pas chez soi ce qu'on y a ecrit soi-meme.
ALTER TABLE "canon_facts" ADD COLUMN "accepted" BOOLEAN;
ALTER TABLE "entities" ADD COLUMN "accepted" BOOLEAN;
