import {
  ContactMessageSchema,
  ContactPageSchema,
  type ContactMessage,
  type ContactPage,
  type ContactRequest,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/** Public : le formulaire s'adresse aussi à qui n'a pas de compte. */
export async function sendContact(request: ContactRequest): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/contact`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) throw new Error(`POST /contact a répondu ${response.status}`);
}

export async function fetchContactMessages(
  options: { cursor?: string; pending?: boolean } = {},
  signal?: AbortSignal,
): Promise<ContactPage> {
  const url = new URL(`${API_BASE_URL}/admin/contact`);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.pending) url.searchParams.set("pending", "true");

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET /admin/contact a répondu ${response.status}`);
  }

  return ContactPageSchema.parse(await response.json());
}

export async function setContactHandled(
  id: string,
  handled: boolean,
): Promise<ContactMessage> {
  const response = await fetch(`${API_BASE_URL}/admin/contact/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ handled }),
  });

  if (!response.ok) {
    throw new Error(`PATCH /admin/contact a répondu ${response.status}`);
  }

  return ContactMessageSchema.parse(await response.json());
}
