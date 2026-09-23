"use client";

import type { BugReport } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Badge, Empty, Feedback, Page, Panel, reasonOf } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { fetchBugReports, fetchBugScreenshot, setBugHandled } from "@/lib/bugs";

/*
  Les bugs signalés depuis le jeu. Même écran que les messages : une liste à
  traiter, un état qui se bascule. La capture se charge à la demande, jamais
  avec la liste : chaque rapport peut en porter une de deux mégaoctets.
*/
export function BugsView() {
  const [reports, setReports] = useState<BugReport[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchBugReports({ pending: pendingOnly }, controller.signal)
      .then((page) => {
        setReports(page.reports);
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
      <Page title="Bugs">
        <Feedback error={error} />
      </Page>
    );
  }

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await fetchBugReports({ cursor, pending: pendingOnly });
      setReports((rows) => [...(rows ?? []), ...page.reports]);
      setCursor(page.nextCursor);
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (report: BugReport) => {
    setBusy(true);
    try {
      const updated = await setBugHandled(report.id, report.handledAt === null);
      setPending((count) => count + (updated.handledAt ? -1 : 1));
      setReports((rows) =>
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
      title="Bugs"
      actions={
        <Button variant="secondary" onClick={() => setPendingOnly((value) => !value)}>
          {pendingOnly ? "Tout voir" : "À traiter seulement"}
        </Button>
      }
    >
      <p className="mb-5 text-ui-sm text-vellum-2">
        {pending === 0 ? "Rien à traiter." : `${pending} bug${pending > 1 ? "s" : ""} à traiter.`}
      </p>

      {reports === null ? (
        <Empty>Lecture des rapports.</Empty>
      ) : reports.length === 0 ? (
        <Empty>Aucun rapport.</Empty>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Panel key={report.id}>
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-control bg-mist px-2 py-0.5 font-ui text-caption text-vellum">
                    {report.page}
                  </code>
                  {report.handledAt ? <Badge>traité</Badge> : null}
                  {report.hasScreenshot ? <Badge tone="accent">capture</Badge> : null}
                </div>

                <p className="text-caption text-vellum-3">
                  {report.username ?? "Joueur sans pseudo"}
                  {report.email ? ` · ${report.email}` : ""}
                  {" · "}
                  {new Date(report.createdAt).toLocaleString("fr-FR")}
                </p>

                <p className="max-w-prose whitespace-pre-wrap text-ui-sm text-vellum-2">
                  {report.message}
                </p>

                <p className="max-w-prose text-caption break-all text-vellum-3">{report.userAgent}</p>

                {report.hasScreenshot ? <Screenshot id={report.id} /> : null}

                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void toggle(report)}>
                  {report.handledAt ? "Rouvrir" : "Marquer traité"}
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

// La capture, chargée au clic et révoquée quand on la replie.
function Screenshot({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const show = async () => {
    setLoading(true);
    try {
      setUrl(await fetchBugScreenshot(id));
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Capture d'écran du rapport" className="max-h-160 rounded-control border border-line" />
        <div className="mt-2 flex gap-3">
          <a href={url} target="_blank" rel="noreferrer" className="text-caption text-vellum-2 underline decoration-line underline-offset-4 hover:text-vellum">
            Ouvrir en grand
          </a>
          <button type="button" onClick={() => setUrl(null)} className="text-caption text-vellum-3 hover:text-vellum">
            Replier
          </button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" disabled={loading} onClick={() => void show()}>
      {loading ? "Lecture." : "Voir la capture"}
    </Button>
  );
}
