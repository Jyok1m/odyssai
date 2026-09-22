"use client";

import type { PlayerProfile } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";
import toast from "react-hot-toast";

import { Link } from "@/i18n/navigation";
import { updateMarketingOptIn } from "@/lib/profile";

/*
  Décoché par défaut : une case pré-cochée n'est pas un consentement. Le
  basculer écrit la date du choix dans les deux sens, un retrait devant se
  prouver aussi bien qu'un accord.

  L'état suit la réponse de l'API et non le clic : en cas d'échec la case
  revient plutôt que de mentir.
*/
export function MarketingOptIn({
  profile,
  onChange,
}: {
  profile: PlayerProfile | null;
  onChange: (profile: PlayerProfile) => void;
}) {
  const t = useTranslations("Account");
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      onChange(await updateMarketingOptIn(next));
    } catch {
      toast.error(t("optInFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-line pt-8">
      <h2 className="font-voice text-subtitle text-vellum">
        {t("optInTitle")}
      </h2>

      <div className="mt-4 flex gap-3">
        <input
          id="marketing-opt-in"
          type="checkbox"
          checked={profile?.marketingOptIn ?? false}
          disabled={profile === null || busy}
          onChange={(event) => void toggle(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent disabled:opacity-50"
        />
        <label htmlFor="marketing-opt-in" className="text-ui-sm text-vellum">
          {t("optInLabel")}
          <span className="mt-1 block text-caption text-vellum-3">
            {t.rich("optInHint", {
              privacy: (chunks) => (
                <Link
                  href="/confidentialite"
                  className="text-vellum-2 underline decoration-line underline-offset-4 transition-colors hover:text-vellum"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
      </div>
    </section>
  );
}
