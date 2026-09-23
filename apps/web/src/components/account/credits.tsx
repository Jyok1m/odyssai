"use client";

import type { BillingCatalog, BillingSummary } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Definition, Panel } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";
import {
  BillingError,
  fetchBillingSummary,
  fetchCatalog,
  openPortal,
} from "@/lib/billing";

/*
  La réserve du joueur.

  Aucun montant en euros ici : les prix vivent chez Stripe, qui les affiche
  sur sa propre page. Les recopier ferait deux vérités, et la fausse serait
  la nôtre.
*/
export function Credits() {
  const t = useTranslations("Billing");
  const format = useFormatter();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetchBillingSummary(controller.signal),
      fetchCatalog(controller.signal),
    ])
      .then(([served, offered]) => {
        setSummary(served);
        setCatalog(offered);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(t(errorKey(caught)));
      });

    return () => controller.abort();
  }, [t]);

  if (error && !summary) {
    return (
      <Panel title={t("title")}>
        <p className="text-ui-sm text-ember">{error}</p>
      </Panel>
    );
  }

  if (!summary || !catalog) {
    return (
      <Panel title={t("title")}>
        <p className="text-ui-sm text-vellum-3">{t("loading")}</p>
      </Panel>
    );
  }

  // Une navigation de premier niveau, jamais un fetch : la page de Stripe
  // refuse d'être chargée en second plan.
  const leave = async (to: () => Promise<string>) => {
    setLeaving(true);
    try {
      window.location.assign(await to());
    } catch (caught: unknown) {
      toast.error(t(errorKey(caught)));
      setLeaving(false);
    }
  };

  const offers = catalog.plans.filter(
    (plan) => plan.purchasable && plan.id !== summary.plan,
  );

  /*
    Un palier sans dotation mensuelle n'a pas de dénominateur, donc pas de
    jauge : diviser par zéro affichait une barre vide et « une dotation de 0
    par mois ».
  */
  const renews = summary.monthly > 0 && !summary.unlimited;

  /*
    Ce que la réserve contenait au départ, bienvenue et ajustements compris :
    le dénominateur du « 47 / 80 » et de la jauge, qui ne peut donc plus
    déborder le premier mois. Absent d'une api plus ancienne, il vaut le solde.
  */
  const granted = summary.granted ?? summary.credits;

  const filled =
    renews && granted > 0 ? Math.round((summary.credits / granted) * 100) : 0;

  // Un administrateur ne consomme rien : une jauge pleine se lirait comme un
  // compteur cassé.
  const balance = summary.unlimited
    ? t("balanceUnlimited")
    : renews
      ? t(granted > summary.monthly ? "balanceWelcome" : "balance", {
          credits: summary.credits,
          monthly: summary.monthly,
        })
      : t("balanceStandalone", { credits: summary.credits });

  return (
    /* Le nom du palier vient de la base : les paliers se créent au tableau de
       bord, leurs noms ne peuvent donc pas être des clés de traduction. */
    <Panel title={t("title")} aside={t("planNamed", { plan: summary.planName })}>
      {/* Le chiffre d'abord : c'est lui qu'on vient voir, et le reste le
          situe. */}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-voice text-display-compact tabular-nums text-vellum">
          {summary.unlimited ? "\u221e" : summary.credits}
        </span>
        {summary.unlimited ? null : (
          <span className="font-voice text-subtitle tabular-nums text-vellum-3">
            / {granted}
          </span>
        )}
        <span className="text-ui-sm text-pretty text-vellum-2">{balance}</span>
      </p>

      {renews ? (
        <div
          role="img"
          aria-label={`${summary.credits} / ${granted} ${balance}`}
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-mist"
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${filled}%` }}
          />
        </div>
      ) : (
        <p className="mt-3 text-caption text-vellum-3">
          {summary.unlimited ? t("unlimitedNote") : t("noRenewal")}
        </p>
      )}

      <dl className="mt-5 divide-y divide-line">
        {/* Une date n'a de sens que si quelque chose arrive à échéance. Sur un
            palier sans dotation, plus rien ne change ce jour-là : la réserve
            reste, et annoncer une date ferait craindre de la perdre. */}
        {renews || summary.cancelAtPeriodEnd ? (
          <Definition
            term={summary.cancelAtPeriodEnd ? t("endsLabel") : t("renewsLabel")}
          >
            {format.dateTime(new Date(summary.renewsAt), {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Definition>
        ) : null}
        <Definition term={t("costsLabel")}>
          {t("costs", {
            turn: catalog.costs.turn,
            world: catalog.costs.worldGeneration,
          })}
        </Definition>
      </dl>

      {offers.length > 0 || summary.manageable ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {/* Un seul bouton vers la page de tarifs, et non un par palier.
              Empilés, les paliers se comparaient mal et l'écran de compte
              devenait une page de vente ; la comparaison est le travail de
              /pricing, qui la fait déjà en colonnes. */}
          {offers.length > 0 ? (
            <Button as={Link} href="/pricing">
              {t("changePlan")}
            </Button>
          ) : null}

          {/* Dès qu'un espace de facturation existe, et non seulement sur un
              palier payant : un joueur revenu au palier libre garde ses
              factures et son moyen de paiement, et doit pouvoir les relire. */}
          {summary.manageable ? (
            <Button
              variant="secondary"
              disabled={leaving}
              onClick={() => void leave(openPortal)}
            >
              {t("manage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function errorKey(caught: unknown) {
  if (!(caught instanceof BillingError)) return "errorGeneric" as const;

  switch (caught.code) {
    case "billing_disabled":
      return "errorDisabled" as const;
    case "unreachable":
      return "errorUnreachable" as const;
    case "unauthenticated":
      return "errorSignedOut" as const;
    default:
      return "errorGeneric" as const;
  }
}
