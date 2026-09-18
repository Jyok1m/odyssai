"use client";

import type { BillingCatalog, BillingSummary } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import {
  BillingError,
  fetchBillingSummary,
  fetchCatalog,
  openPortal,
  startCheckout,
} from "@/lib/billing";

/**
 * La réserve du joueur.
 *
 * Aucun montant en euros ici : les prix vivent chez Stripe, qui les affiche
 * sur sa propre page. Les recopier ferait deux vérités, et la fausse serait
 * la nôtre.
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
      <section>
        <Heading />
        <p className="mt-3 text-ui-sm text-ember">{error}</p>
      </section>
    );
  }

  if (!summary || !catalog) {
    return (
      <section>
        <Heading />
        <p className="mt-3 text-ui-sm text-vellum-3">{t("loading")}</p>
      </section>
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

  const price = (cents: number | null, currency: string) =>
    cents === null
      ? null
      : format.number(cents / 100, { style: "currency", currency });

  // La jauge peut dépasser sa dotation le premier mois, la bienvenue s'y
  // ajoutant : elle se borne à cent pour cent plutôt que de déborder.
  const filled = summary.monthly
    ? Math.min(100, Math.round((summary.credits / summary.monthly) * 100))
    : 0;

  return (
    <section>
      <Heading />

      <p className="mt-3 text-ui-sm text-vellum">
        {t("balance", { credits: summary.credits, monthly: summary.monthly })}
      </p>

      <div
        role="img"
        aria-label={t("balance", {
          credits: summary.credits,
          monthly: summary.monthly,
        })}
        className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-mist"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${filled}%` }}
        />
      </div>

      <dl className="mt-4 space-y-2">
        <div className="flex gap-2">
          <dt className="text-caption text-vellum-3">{t("planLabel")}</dt>
          {/* Le nom vient de la base : les paliers se creent au tableau de
              bord, leurs noms ne peuvent donc pas etre des cles de
              traduction. */}
          <dd className="text-ui-sm text-vellum">{summary.planName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-caption text-vellum-3">
            {summary.cancelAtPeriodEnd ? t("endsLabel") : t("renewsLabel")}
          </dt>
          <dd className="text-ui-sm text-vellum">
            {format.dateTime(new Date(summary.renewsAt), {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-ui-sm text-vellum-3">
        {t("costs", {
          turn: catalog.costs.turn,
          world: catalog.costs.worldGeneration,
        })}
      </p>

      {offers.length > 0 || summary.purchasable ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {offers.map((plan) => (
            <Button
              key={plan.id}
              disabled={leaving}
              onClick={() => void leave(() => startCheckout(plan.id))}
            >
              {t("upgradeTo", { plan: plan.name, credits: plan.monthly })}
              {/* Le montant vient de Stripe, recopie a l'affichage : le
                  bouton ne doit pas envoyer sur une page de paiement dont le
                  prix serait une surprise. */}
              {price(plan.amountCents, plan.currency) ? (
                <span className="text-vellum-2">
                  {price(plan.amountCents, plan.currency)}
                </span>
              ) : null}
            </Button>
          ))}

          {/* Le portail n'a de sens qu'avec un abonnement à gérer. */}
          {summary.plan !== "free" ? (
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

      {offers.length > 0 ? (
        <p className="mt-3 text-caption text-vellum-3">{t("priceAtCheckout")}</p>
      ) : null}
    </section>
  );
}

function Heading() {
  const t = useTranslations("Billing");

  return (
    <h2 className="font-voice text-subtitle text-vellum">{t("title")}</h2>
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
