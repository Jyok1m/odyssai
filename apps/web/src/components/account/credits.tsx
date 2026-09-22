"use client";

import type { BillingCatalog, BillingSummary } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
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

  /*
    Un palier sans dotation mensuelle n'a pas de dénominateur, donc pas de
    jauge : diviser par zéro affichait une barre vide et « une dotation de 0
    par mois ».
  */
  const renews = summary.monthly > 0 && !summary.unlimited;

  // La jauge peut dépasser sa dotation le premier mois, la bienvenue s'y
  // ajoutant : elle se borne à cent pour cent plutôt que de déborder.
  const filled = renews
    ? Math.min(100, Math.round((summary.credits / summary.monthly) * 100))
    : 0;

  /*
    Tant que le solde dépasse la dotation, « 55 sur 30 » se lit comme une
    incohérence : le surplus vient de la bienvenue. Sa part exacte n'est pas
    affichée, le grand livre ne sachant plus quel crédit a été consommé.

    Un administrateur ne consomme rien : une jauge pleine se lirait comme un
    compteur cassé.
  */
  const balance = summary.unlimited
    ? t("balanceUnlimited")
    : renews
      ? t(summary.credits > summary.monthly ? "balanceWelcome" : "balance", {
          credits: summary.credits,
          monthly: summary.monthly,
        })
      : t("balanceStandalone", { credits: summary.credits });

  return (
    <section>
      <Heading />

      <p className="mt-3 text-ui-sm text-vellum">{balance}</p>

      {renews ? (
        <div
          role="img"
          aria-label={balance}
          className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-mist"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${filled}%` }}
          />
        </div>
      ) : (
        <p className="mt-2 text-caption text-vellum-3">
          {summary.unlimited ? t("unlimitedNote") : t("noRenewal")}
        </p>
      )}

      <dl className="mt-4 space-y-2">
        <div className="flex gap-2">
          <dt className="text-caption text-vellum-3">{t("planLabel")}</dt>
          {/* Le nom vient de la base : les paliers se creent au tableau de
              bord, leurs noms ne peuvent donc pas etre des cles de
              traduction. */}
          <dd className="text-ui-sm text-vellum">{summary.planName}</dd>
        </div>
        {/* Une date n'a de sens que si quelque chose arrive a echeance. Sur un
            palier sans dotation, plus rien ne change ce jour la : la reserve
            reste, et annoncer une date ferait craindre de la perdre. */}
        {renews || summary.cancelAtPeriodEnd ? (
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
        ) : null}
      </dl>

      <p className="mt-4 text-ui-sm text-vellum-3">
        {t("costs", {
          turn: catalog.costs.turn,
          world: catalog.costs.worldGeneration,
        })}
      </p>

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
