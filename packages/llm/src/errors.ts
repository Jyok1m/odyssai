/*
  Erreur d'appel au fournisseur. Ne porte jamais de cle ni de prompt : ce qui
  remonte ici finit dans les journaux, et parfois dans une reponse.
*/
export class LlmError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean }) {
    super(message);
    this.name = 'LlmError';
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

// 408, 409, 429 et les 5xx valent la peine d'etre retentees, pas les 4xx.
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/*
  Ce qui vaut un second essai, vu d'un appelant.

  Un abandon n'en vaut pas : le joueur est parti. Un refus franc du
  fournisseur non plus : la requete est en cause, pas le reseau. Tout le reste
  est inconnu, donc retentable une fois, comme `toLlmError` le decide deja
  pour ce qu'il ne reconnait pas.
*/
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError) return error.retryable;
  if (error instanceof Error && error.name === 'AbortError') return false;
  return true;
}
