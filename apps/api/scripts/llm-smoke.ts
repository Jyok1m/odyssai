/*
  Un appel reel, pour verifier que la configuration du guide tient debout :
  modele joignable, usage renseigne, cout rendu par le fournisseur.

  La trace, elle, ne se verifie plus ici : c'est OpenRouter qui la diffuse
  vers la destination configuree chez lui, et rien dans la reponse ne dit si
  elle est partie. Le corps porte les metadonnees, c'est tout ce que ce code
  controle encore.

    pnpm --filter @odyssai/api llm:smoke

  Aucune cle ni aucune configuration n'est affichee, seulement le resultat.
*/
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

const client = createLlmClient({
  provider: config.provider,
  apiKey: config.apiKey,
});

let usage: Extract<LlmStreamEvent, { type: 'usage' }> | undefined;
let text = '';

for await (const event of client.streamChat({
  model: config.model.model,
  messages: [{ role: 'user', content: 'Dis bonjour en une phrase.' }],
  maxOutputTokens: 30,
  temperature: config.model.temperature,
  extraBody: config.extraBody,
  trace: { name: 'guide', tags: ['smoke'], metadata: { smoke: true } },
})) {
  if (event.type === 'text') text += event.text;
  if (event.type === 'usage') usage = event;
}

console.log(
  JSON.stringify(
    {
      provider: config.provider,
      model: usage?.model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      costUsd: usage?.costUsd,
      answerChars: text.length,
    },
    null,
    2,
  ),
);
