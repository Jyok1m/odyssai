import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'langsmith';
import { createLlmClient } from '@odyssai/llm';
import { createPrismaClient, loadRootEnvFile } from '@odyssai/db';
import { GENERATION_QUEUE, GenerationJobDataSchema } from '@odyssai/schemas';
import { loadConfig } from './config.js';
import { NothingToDo, generate } from './generate.js';

loadRootEnvFile(process.cwd());

const config = loadConfig();
const log = (message: string) =>
  console.log(`${new Date().toISOString()} ${message}`);

const prisma = createPrismaClient(config.postgresUrl);

const llm = createLlmClient({
  provider: config.provider,
  apiKey: config.apiKey,
  tracing: config.tracing.enabled
    ? {
        client: new Client({
          apiUrl: config.tracing.endpoint,
          apiKey: config.tracing.apiKey,
          workspaceId: config.tracing.workspaceId,
          hideInputs: config.tracing.hideIo,
          hideOutputs: config.tracing.hideIo,
        }),
        projectName: config.tracing.project,
        // Une generation par monde, sept appels : tout tracer coute peu et
        // vaut cher le jour ou un monde sort de travers.
        sampleRate: 1,
      }
    : undefined,
});

/*
  Le checkpointer cree ses tables au demarrage, dans son propre schema et non
  dans `public` : la, Prisma ne les voyant pas declarees, chaque `migrate diff`
  proposait de les supprimer et aurait efface l'etat des generations en cours.
*/
const checkpointer = PostgresSaver.fromConnString(config.postgresUrl, {
  schema: 'langgraph',
});
await checkpointer.setup();

/*
  Meme classe a l'execution, deux identites de type a la compilation :
  `packages/narrator` est en CommonJS, donc ses declarations resolvent
  @langchain/core par la condition `require`, tandis que ce worker, en ESM,
  le resout par `import`. Le jour ou narrator passera en ESM, cette conversion
  tombera d'elle-meme.
*/
const saver = checkpointer as unknown as Parameters<
  typeof generate
>[0]['checkpointer'];

// BullMQ met ses consommateurs en mode bloquant : sa connexion lui est propre,
// et ne doit pas repartir en erreur au bout de trois essais.
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  GENERATION_QUEUE,
  async (job: Job<unknown>) => {
    const parsed = GenerationJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('charge utile invalide');

    const { universeId } = parsed.data;
    log(`generation ${universeId} : depart`);

    const started = Date.now();
    await generate({ prisma, llm, config, checkpointer: saver }, universeId);
    log(`generation ${universeId} : finie en ${Math.round((Date.now() - started) / 1000)} s`);
  },
  {
    connection,
    concurrency: config.concurrency,
    // Sept appels de modele : un monde peut prendre plusieurs minutes, et un
    // verrou trop court le ferait reprendre alors qu'il tourne encore.
    lockDuration: 600_000,
  },
);

worker.on('failed', (job, error) => {
  // NothingToDo n'est pas une panne : le travail n'avait plus lieu d'etre.
  const reason = error instanceof NothingToDo ? 'sans objet' : error.message;
  log(`generation ${job?.data ? JSON.stringify(job.data) : '?'} : echec, ${reason}`);
});

worker.on('error', (error) => log(`worker : ${error.message}`));

log(
  `worker pret sur ${GENERATION_QUEUE}, ${config.concurrency} monde(s) a la fois, modele ${config.model.model}`,
);

// Le travail en cours va au bout : le couper laisserait un monde a moitie ecrit.
async function shutdown(signal: string): Promise<void> {
  log(`${signal} : arret apres le travail en cours`);
  await worker.close();
  await llm.flushTraces();
  await checkpointer.end();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
