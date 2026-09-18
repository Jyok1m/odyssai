"use client";

import type { ContactMessage } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Badge, Empty, Feedback, Page, Panel, reasonOf } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { fetchContactMessages, setContactHandled } from "@/lib/contact";

/**
 * Les messages du formulaire de contact.
 *
 * Ils partent aussi par courriel, mais restent lisibles ici : un envoi peut
 * échouer, et une boîte peut se perdre. `delivered` dit lesquels ne sont
 * jamais partis, ce sont ceux à ne pas manquer.
 */
export function ContactView() {
  const [messages, setMessages] = useState<ContactMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchContactMessages({ pending: pendingOnly }, controller.signal)
      .then((page) => {
        setMessages(page.messages);
        setCursor(page.nextCursor);
        setPending(page.pending);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(caught));
      });

    return () => controller.abort();
  }, [pendingOnly]);

  if (error) {
    return (
      <Page title="Messages">
        <Feedback error={error} />
      </Page>
    );
  }

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await fetchContactMessages({ cursor, pending: pendingOnly });
      setMessages((rows) => [...(rows ?? []), ...page.messages]);
      setCursor(page.nextCursor);
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (message: ContactMessage) => {
    setBusy(true);
    try {
      const updated = await setContactHandled(message.id, message.handledAt === null);
      setPending((count) => count + (updated.handledAt ? -1 : 1));
      setMessages((rows) =>
        pendingOnly && updated.handledAt
          ? (rows ?? []).filter((row) => row.id !== updated.id)
          : (rows ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Messages"
      actions={
        <Button variant="secondary" onClick={() => setPendingOnly((value) => !value)}>
          {pendingOnly ? "Tout voir" : "À traiter seulement"}
        </Button>
      }
    >
      <p className="mb-5 text-ui-sm text-vellum-2">
        {pending === 0
          ? "Rien à traiter."
          : `${pending} message${pending > 1 ? "s" : ""} à traiter.`}
      </p>

      {messages === null ? (
        <Empty>Lecture des messages.</Empty>
      ) : messages.length === 0 ? (
        <Empty>Aucun message.</Empty>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <Panel key={message.id}>
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-voice text-ui text-vellum">
                    {message.subject}
                  </span>
                  {message.handledAt ? <Badge>traité</Badge> : null}
                  {/* Le seul etat qui demande une action de plus : personne ne
                      l'a recu par courriel. */}
                  {!message.delivered ? (
                    <Badge tone="danger">non envoyé</Badge>
                  ) : null}
                </div>

                <p className="text-caption text-vellum-3">
                  {message.name ? `${message.name}, ` : ""}
                  <a
                    href={`mailto:${message.email}?subject=Re: ${encodeURIComponent(message.subject)}`}
                    className="text-vellum-2 underline decoration-line underline-offset-4 hover:text-vellum"
                  >
                    {message.email}
                  </a>
                  {" · "}
                  {new Date(message.createdAt).toLocaleString("fr-FR")}
                </p>

                <p className="max-w-prose whitespace-pre-wrap text-ui-sm text-vellum-2">
                  {message.message}
                </p>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void toggle(message)}
                >
                  {message.handledAt ? "Rouvrir" : "Marquer traité"}
                </Button>
              </div>
            </Panel>
          ))}

          {cursor ? (
            <Button variant="secondary" disabled={busy} onClick={() => void more()}>
              {busy ? "Lecture." : "Voir plus"}
            </Button>
          ) : null}
        </div>
      )}
    </Page>
  );
}
