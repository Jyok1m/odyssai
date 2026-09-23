import { describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@odyssai/db';
import { AlphaService } from './alpha.service.js';

type AdapterFactory = NonNullable<Prisma.PrismaClientOptions['adapter']>;

/*
  Le vrai client sur un faux pilote, qui repond vide a tout : le double des
  e2e ne reproduit pas le regroupement des `findUnique` concurrents, et c'est
  lui qui cassait en production.
*/
function fakeAdapter(sql: string[]): AdapterFactory {
  const connection = {
    provider: 'postgres' as const,
    adapterName: 'fake',
    queryRaw: async (query: { sql: string }) => {
      sql.push(query.sql);
      return { columnNames: [], columnTypes: [], rows: [] };
    },
    executeRaw: async () => 0,
    executeScript: async () => {},
    startTransaction: async () => {
      throw new Error('pas de transaction ici');
    },
    dispose: async () => {},
  };

  return {
    provider: 'postgres',
    adapterName: 'fake',
    connect: async () => connection,
  };
}

describe('lecture des reglages du site', () => {
  /*
    La ligne unique a une cle booleenne, et Prisma regroupe les `findUnique`
    concurrents d'un meme tick en un `findMany` sur `id: { in: [...] }`, que
    `BoolFilter` ne connait pas : deux requetes de jeu arrivees ensemble
    tombaient en 500 sur « Unknown argument in ».
  */
  it('tient deux lectures concurrentes', async () => {
    const sql: string[] = [];
    const prisma = new PrismaClient({ adapter: fakeAdapter(sql) });
    const alpha = new AlphaService(prisma);

    try {
      await expect(
        Promise.all([alpha.isOpen(), alpha.isOpen(), alpha.salesOpen()]),
      ).resolves.toEqual([false, false, false]);
    } finally {
      await prisma.$disconnect();
    }

    expect(sql).toHaveLength(3);
    for (const query of sql) expect(query).toContain('"site_settings"');
  });
});
