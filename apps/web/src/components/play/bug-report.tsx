"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { BUG_MESSAGE_MAX, BUG_MESSAGE_MIN, SCREENSHOT_MAX_BYTES, SCREENSHOT_TYPES } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { FIELD_AREA } from "@/components/ui/field";
import { usePathname } from "@/i18n/navigation";
import { sendBugReport } from "@/lib/bugs";

/*
  Signaler un bug depuis le jeu : une phrase, la page d'où l'on écrit, et une
  capture si on en a une. Le rapport se lit au tableau de bord.

  Derrière la session seulement : le bandeau du jeu se voit aussi porte
  fermée, et c'est là qu'on a le plus besoin d'entendre ce qui cloche, mais
  un anonyme n'a rien à quoi rattacher son rapport.
*/
export function BugReportButton() {
  const t = useTranslations("Bug");
  const session = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (session.status !== "authenticated") return null;

  return (
    <>
      <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
      {open ? <BugReportDialog page={pathname} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BugReportDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const t = useTranslations("Bug");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'URL d'objet de l'aperçu se révoque avec lui.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pick = (picked: File | null) => {
    setError(null);
    if (!picked) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!(SCREENSHOT_TYPES as readonly string[]).includes(picked.type)) {
      setError(t("wrongType"));
      return;
    }
    if (picked.size > SCREENSHOT_MAX_BYTES) {
      setError(t("tooLarge", { max: Math.round(SCREENSHOT_MAX_BYTES / 1024 / 1024) }));
      return;
    }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < BUG_MESSAGE_MIN || busy) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("page", page);
      form.set("message", message.trim());
      if (file) form.set("screenshot", file);
      await sendBugReport(form);
      toast.success(t("sent"));
      onClose();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
      />

      <div className="fixed inset-0 flex items-end justify-center p-4 sm:items-center">
        <DialogPanel
          transition
          className="w-full max-w-lg rounded-card border border-line bg-abyss p-6 transition duration-300 ease-out data-closed:translate-y-4 data-closed:opacity-0"
        >
          <DialogTitle className="font-voice text-subtitle text-vellum">{t("title")}</DialogTitle>
          <p className="mt-1 text-ui-sm text-pretty text-vellum-3">{t("lead", { page })}</p>

          <form onSubmit={(event) => void submit(event)} data-focus-ring="container" className="mt-5 space-y-4">
            <div>
              <label htmlFor="bug-message" className="text-caption text-vellum-3">
                {t("message")}
              </label>
              <textarea
                id="bug-message"
                rows={5}
                value={message}
                maxLength={BUG_MESSAGE_MAX}
                placeholder={t("messagePlaceholder")}
                onChange={(event) => setMessage(event.target.value)}
                className={`mt-1.5 ${FIELD_AREA}`}
              />
            </div>

            <div>
              <p className="text-caption text-vellum-3">{t("screenshot")}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                {/* Un libellé en bouton autour du champ : le champ natif ne
                    s'habille pas, le libellé si. */}
                <label className="inline-flex h-8 cursor-pointer items-center rounded-control border border-line px-3 font-ui text-ui-sm font-medium text-vellum transition-colors hover:border-vellum-3 hover:bg-mist">
                  {file ? t("screenshotChange") : t("screenshotPick")}
                  <input
                    type="file"
                    accept={SCREENSHOT_TYPES.join(",")}
                    className="sr-only"
                    onChange={(event) => pick(event.target.files?.[0] ?? null)}
                  />
                </label>
                {file ? (
                  <Button variant="ghost" size="sm" type="button" onClick={() => pick(null)}>
                    {t("screenshotRemove")}
                  </Button>
                ) : (
                  <span className="text-caption text-vellum-3">
                    {t("screenshotHint", { max: Math.round(SCREENSHOT_MAX_BYTES / 1024 / 1024) })}
                  </span>
                )}
              </div>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt=""
                  className="mt-3 max-h-48 rounded-control border border-line object-contain"
                />
              ) : null}
            </div>

            <p aria-live="polite" className="min-h-5 text-ui-sm text-ember">
              {error}
            </p>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy || message.trim().length < BUG_MESSAGE_MIN}>
                {t("send")}
              </Button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
