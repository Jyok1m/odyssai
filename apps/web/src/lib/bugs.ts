import {
  BugReportPageSchema,
  BugReportSchema,
  type BugReport,
  type BugReportPage,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

// Multipart, la capture à côté du texte : le navigateur pose lui-même le type.
export async function sendBugReport(form: FormData): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/bugs`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
    body: form,
  });

  if (!response.ok) throw new Error(`POST /bugs a répondu ${response.status}`);
}

export async function fetchBugReports(
  options: { cursor?: string; pending?: boolean } = {},
  signal?: AbortSignal,
): Promise<BugReportPage> {
  const url = new URL(`${API_BASE_URL}/admin/bugs`);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.pending) url.searchParams.set("pending", "true");

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`GET /admin/bugs a répondu ${response.status}`);

  return BugReportPageSchema.parse(await response.json());
}

export async function setBugHandled(id: string, handled: boolean): Promise<BugReport> {
  const response = await fetch(`${API_BASE_URL}/admin/bugs/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ handled }),
  });

  if (!response.ok) throw new Error(`PATCH /admin/bugs a répondu ${response.status}`);

  return BugReportSchema.parse(await response.json());
}

/*
  La capture, en URL d'objet : une balise image ne porte pas le cookie de
  l'API, la lecture passe donc par fetch, comme le reste du tableau de bord.
  À révoquer quand on ne l'affiche plus.
*/
export async function fetchBugScreenshot(id: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/admin/bugs/${id}/screenshot`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`GET /admin/bugs/:id/screenshot a répondu ${response.status}`);

  return URL.createObjectURL(await response.blob());
}
