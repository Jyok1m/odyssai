"use client";

import type { OnboardingState } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { Tag } from "@/components/ui/panel";
import { useRouter } from "@/i18n/navigation";
import { PartyError, leaveParty } from "@/lib/party";

/*
  La table pendant l'assemblage : le code à partager, les sièges, qui est
  prêt. Elle se lit au fil de l'eau : l'état du parcours revient à chaque
  enregistrement, et chaque joueur qui avance fait bouger le sien.

  Un panneau et rien d'un tableau de bord : le joueur remplit sa part au-dessus,
  et ceci dit où en sont les autres.
*/
export function PartyPanel({ party }: { party: NonNullable<OnboardingState["party"]> }) {
  const t = useTranslations("Play.party");
  const tDanger = useTranslations("Danger");
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(party.inviteCode);
      setCopied(true);
    } catch {
      // Le presse-papier peut être refusé : le code reste à l'écran, le
      // copier à la main est toujours possible.
      setCopied(false);
    }
  };

  const leave = async () => {
    setError(null);
    try {
      await leaveParty();
      // Le joueur n'a plus d'histoire ouverte : le parcours en commence une
      // neuve.
      router.push("/play/stories");
    } catch (caught: unknown) {
      setError(
        caught instanceof PartyError && caught.code === "locked"
          ? t("leaveLocked")
          : tDanger("error"),
      );
    }
  };

  return (
    <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
      <h2 className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
        {t("title")}
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="font-voice text-subtitle tracking-[0.2em] text-vellum">
          {party.inviteCode}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={() => void share()}>
          {copied ? t("copied") : t("copy")}
        </Button>
        <p className="text-ui-sm text-vellum-3">
          {t("seats", { taken: party.members.length, size: party.size })}
        </p>
      </div>

      <ul className="mt-5 space-y-3">
        {party.members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-voice text-ui-sm text-vellum">
              {member.characterName ?? member.username ?? t("unnamed")}
            </span>
            {member.host ? <Tag tone="brass">{t("host")}</Tag> : null}
            {member.mine ? <Tag tone="accent">{t("you")}</Tag> : null}
            <span className="text-caption text-vellum-3">
              {member.ready ? t("ready") : t("waiting")}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 max-w-measure text-ui-sm text-pretty text-vellum-3">
        {t("lead")}
      </p>

      <div className="mt-5">
        <DangerAction
          label={tDanger("leaveParty")}
          title={t("leaveTitle")}
          lead={t("leaveLead")}
          confirmLabel={tDanger("leaveParty")}
          busyLabel={tDanger("busy")}
          onConfirm={() => leave()}
          error={error}
        />
      </div>
    </section>
  );
}
