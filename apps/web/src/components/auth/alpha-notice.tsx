"use client";

import { XMarkIcon } from "@heroicons/react/20/solid";
import type { AlphaStatus } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAlpha } from "@/components/auth/alpha-provider";

/*
  L'annonce de l'alpha, en bandeau sur tout le site. Un bandeau et non un
  toast : ce qu'il dit se relit, et une personne le ferme quand elle l'a lu.
*/
export function AlphaNotice() {
  const t = useTranslations("Auth");
  // Un bandeau d'annonce ne vaut pas un message d'erreur : sans état, la
  // page reste entière.
  const { status } = useAlpha();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !status || !status.notice) return null;

  return (
    <div role="status" className="border-b border-line bg-mist/60 px-6 py-3 lg:px-8">
      <div className="mx-auto flex max-w-wrap items-center gap-4">
        <p className="flex-1 text-ui-sm text-vellum-2">
          <Announcement status={status} />
        </p>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="-m-1.5 shrink-0 rounded-control p-1.5 text-vellum-3 transition-colors hover:text-vellum"
        >
          <span className="sr-only">{t("noticeClose")}</span>
          <XMarkIcon aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}

/*
  Ouverte : le jeu se joue, avec ses bugs, et les premiers inscrits ont leur
  bonus tant qu'il en reste. Fermée : maintenance ou remise à zéro, les
  comptes restent.
*/
function Announcement({ status }: { status: AlphaStatus }) {
  const t = useTranslations("Auth");

  if (status.phase !== "open") {
    return (
      <>
        <span className="font-medium text-vellum">{t("noticeClosedTitle")}</span>{" "}
        {t("noticeClosedBody")}
      </>
    );
  }

  return (
    <>
      <span className="font-medium text-vellum">{t("noticeOpenTitle")}</span>{" "}
      {t("noticeOpenBody", {
        seats: status.founders.seats,
        credits: status.founders.credits,
        remaining: status.founders.remaining,
      })}
    </>
  );
}
