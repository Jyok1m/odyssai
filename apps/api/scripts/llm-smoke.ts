/*
  Un appel reel, pour verifier que la configuration du guide tient debout :
  modele joignable, usage renseigne, trace deposee si le tracing est actif.

    pnpm --filter @odyssai/api llm:smoke

  Aucune cle ni aucune configuration n'est affichee, seulement le resultat.
*/
import { Client } from 'langsmith';
import { createLlmClient, type LlmStreamEvent } from '@odyssai/llm';
import { GuideConfig } from '../dist/config/guide-config.js';
import { loadRootEnvFile } from '@odyssai/db';

loadRootEnvFile(new URL('..', import.meta.url).pathname);

const config = new GuideConfig();

// Presence seulement : la valeur ne doit jamais atteindre la sortie standard.
if (!config.apiKey) {
  console.error(
    `cle absente pour le fournisseur ${config.provider}, rien n'a ete appele`,
  );
  process.exit(1);
}

const { tracing } = config;
const client = createLlmClient({
  provider: config.provider,
  apiKey: config.apiKey,
  tracing: tracing.enabled
    ? {
        client: new Client({
          apiUrl: tracing.endpoint,
          apiKey: tracing.apiKey,
          workspaceId: tracing.workspaceId,
        }),
        projectName: tracing.project,
        // Un controle sans trace ne controlerait pas le tracing.
        sampleRate: 1,
      }
    : undefined,
});

let traced = false;
let usage: Extract<LlmStreamEvent, { type: 'usage' }> | undefined;
let text = '';

for await (const event of client.streamChat({
  model: config.model.model,
  messages: [{ role: 'user', content: 'Dis bonjour en une phrase.' }],
  maxOutputTokens: 30,
  temperature: config.model.temperature,
  extraBody: config.extraBody,
  onTraced: (value) => {
    traced = value;
  },
  trace: { name: 'guide', tags: ['smoke'], metadata: { smoke: true } },
})) {
  if (event.type === 'text') text += event.text;
  if (event.type === 'usage') usage = event;
}

await client.flushTraces();

console.log(
  JSON.stringify(
    {
      provider: config.provider,
      model: usage?.model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      costUsd: usage?.costUsd,
      traced,
      answerChars: text.length,
    },
    null,
    2,
  ),
);
