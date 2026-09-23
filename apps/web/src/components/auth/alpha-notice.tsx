"use client";

import { XMarkIcon } from "@heroicons/react/20/solid";
import type { AlphaStatus } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { useAlpha } from "@/components/auth/alpha-provider";

export const ALPHA_FULL_PARAM = "auth_error";
export const ALPHA_FULL_CODE = "alpha_full";

/*
  L'annonce des places et le refus d'inscription au même endroit : le second
  efface la première, devenue fausse. Un bandeau et non un toast, une
  inscription refusée n'étant pas une notification de trois secondes.

  `useSearchParams` sous `Suspense` garde le prérendu statique du layout, et
  le paramètre reste dans l'URL jusqu'à la fermeture : actualiser la page ne
  rouvre pas l'alpha.
*/
export function AlphaNotice() {
  const t = useTranslations("Auth");
  const params = useSearchParams();
  // Un bandeau d'annonce ne vaut pas un message d'erreur : sans état, la
  // page reste entière.
  const { status } = useAlpha();
  const [dismissed, setDismissed] = useState(false);

  const refused = params.get(ALPHA_FULL_PARAM) === ALPHA_FULL_CODE;

  if (dismissed) return null;
  if (!refused && (!status || !status.notice)) return null;

  const close = () => {
    setDismissed(true);
    if (!refused) return;

    // Nettoyé à la fermeture seulement : partager l'adresse ne doit pas
    // transmettre un refus qui ne concernait que celui qui l'a reçu.
    const url = new URL(window.location.href);
    url.searchParams.delete(ALPHA_FULL_PARAM);
    window.history.replaceState(null, "", url.toString());
  };

  const tone = refused || status?.full
    ? "border-brass/40 bg-brass/12"
    : "border-line bg-mist/60";

  return (
    <div role="status" className={`border-b px-6 py-3 lg:px-8 print:hidden ${tone}`}>
      <div className="mx-auto flex max-w-wrap items-center gap-4">
        <p className="flex-1 text-ui-sm text-vellum-2">
          {refused ? (
            <>
              <span className="font-medium text-vellum">
                {t("alphaFullTitle")}
              </span>{" "}
              {t("alphaFullBody")}
            </>
          ) : status ? (
            <Announcement status={status} />
          ) : null}
        </p>

        <button
          type="button"
          onClick={close}
          className="-m-1.5 shrink-0 rounded-control p-1.5 text-vellum-3 transition-colors hover:text-vellum"
        >
          <span className="sr-only">{t("alphaFullClose")}</span>
          <XMarkIcon aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}

/*
  L'annonce, selon la phase choisie au tableau de bord et le compte des
  places. « Complète » n'est pas une phase : c'est ce qui reste qui le dit.
*/
function Announcement({ status }: { status: AlphaStatus }) {
  const t = useTranslations("Auth");

  if (status.full) {
    return (
      <>
        <span className="font-medium text-vellum">
          {t("noticeFullTitle")}
        </span>{" "}
        {t("noticeFullBody", { seats: status.seats })}
      </>
    );
  }

  return (
    <>
      <span className="font-medium text-vellum">
        {t(status.phase === "open" ? "noticeOpenTitle" : "noticePreTitle")}
      </span>{" "}
      {t(status.phase === "open" ? "noticeOpenBody" : "noticePreBody", {
        seats: status.seats,
        remaining: status.remaining,
      })}
    </>
  );
}
