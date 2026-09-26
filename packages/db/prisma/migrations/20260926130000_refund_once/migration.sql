-- Un debit ne se rembourse qu'une fois : un remboursement porte en ref
-- l'identifiant du debit qu'il annule, et l'index partiel le rend unique en
-- base plutot que dans les services. Deux chemins le lisaient chacun dans le
-- grand livre avant d'ecrire (le depart d'une table, le solde d'une
-- generation ratee), et deux lectures concurrentes rendaient deux fois.
--
-- Echoue si le grand livre porte deja deux remboursements d'un meme debit :
-- ce sont des credits crees de rien, a relire avant de deployer.
CREATE UNIQUE INDEX "credit_entries_refund_ref_key" ON "credit_entries" ("ref") WHERE "reason" = 'refund';
