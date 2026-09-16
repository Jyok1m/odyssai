/**
 * Erreur d'appel au fournisseur. Ne porte jamais de cle ni de prompt : ce qui
 * remonte ici finit dans les journaux, et parfois dans une reponse.
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

/** 408, 409, 429 et les 5xx valent la peine d'etre retentees, pas les 4xx. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
