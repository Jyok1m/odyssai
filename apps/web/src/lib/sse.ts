/*
  Assez d'un schéma Zod pour valider, sans faire de zod une dépendance de
  `apps/web` : les schémas arrivent déjà compilés depuis `@odyssai/schemas`.
*/
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/*
  Lecteur de flux SSE, commun au guide et à la conversation de personnage.

  Découpage sur `\n\n` en gardant le reste : un événement arrive souvent coupé
  entre deux morceaux, et le recoller est ce qui distingue ce lecteur d'un
  `split`. Un événement invalide est ignoré plutôt que de faire tomber le flux.
*/
export async function readEventStream<T>(
  response: Response,
  schema: Parser<T>,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        // Les lignes de commentaire, dont les `: ping`, ne portent rien.
        if (line.startsWith(":") || !line.startsWith("data:")) continue;

        const parsed = schema.safeParse(
          safeJsonParse(line.slice("data:".length).trim()),
        );
        if (parsed.success) onEvent(parsed.data);
      }
    }
  }
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
