"use client";

import { CheckIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { BillingCatalog, PlanOffer } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { useAuthLinks } from "@/components/auth/auth-links";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fetchCatalog } from "@/lib/billing";

/**
 * La grille des paliers, le comparatif et la foire aux questions.
 *
 * Tout vient de `GET /billing/catalog`, public et sans session : le barème n'a
 * rien de personnel, et un visiteur doit voir les prix avant de s'inscrire.
 *
 * **Rien n'est écrit en dur ici**, ni un nom de palier, ni un montant, ni une
 * dotation. Les paliers se créent au tableau de bord et leurs noms ne sont pas
 * connus à la compilation ; les montants vivent chez Stripe, les recopier
 * ferait deux vérités. Même les lignes du comparatif se déduisent des
 * chiffres, pour qu'un palier ajouté demain s'y range sans qu'on y touche.
 */
export function Pricing() {
  const t = useTranslations("Pricing");
  const session = useSession();
  const { signIn } = useAuthLinks();

  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchCatalog(controller.signal)
      .then(setCatalog)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => controller.abort();
  }, []);

  if (failed) {
    return <p className="mt-10 text-ui-sm text-ember">{t("error")}</p>;
  }

  if (!catalog) {
    return <p className="mt-10 text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  // La vedette est le palier payant du milieu : ni le moins cher, ni le plus
  // cher. Elle se calcule plutôt que de se nommer, sans quoi renommer un
  // palier au tableau de bord la ferait disparaître.
  const paid = catalog.plans.filter((plan) => plan.amountCents !== null);
  const featured = paid.length > 2 ? paid[Math.floor(paid.length / 2)]?.id : undefined;

  return (
    <>
      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {catalog.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            costs={catalog.costs}
            featured={plan.id === featured}
            signIn={signIn}
            authenticated={session.status === "authenticated"}
          />
        ))}
      </div>

      <Comparison catalog={catalog} featured={featured} />

      <section className="mt-24 sm:mt-32">
        <h2 className="font-voice text-title text-balance text-vellum">
          {t("faqTitle")}
        </h2>
        <dl className="mt-12 divide-y divide-line">
          {(t.raw("faq") as { question: string; answer: string }[]).map(
            (entry) => (
              <div
                key={entry.question}
                className="py-8 first:pt-0 last:pb-0 lg:grid lg:grid-cols-12 lg:gap-8"
              >
                <dt className="font-ui text-ui font-medium text-vellum lg:col-span-5">
                  {entry.question}
                </dt>
                <dd className="mt-3 text-ui text-vellum-2 lg:col-span-7 lg:mt-0">
                  {entry.answer}
                </dd>
              </div>
            ),
          )}
        </dl>
      </section>

      <p className="mt-16 text-caption text-vellum-3">
        {t("costsNote", {
          turn: catalog.costs.turn,
          world: catalog.costs.worldGeneration,
        })}
      </p>
    </>
  );
}

/** Une carte de palier. Tout son contenu se déduit des chiffres du catalogue. */
function PlanCard({
  plan,
  costs,
  featured,
  signIn,
  authenticated,
}: {
  plan: PlanOffer;
  costs: BillingCatalog["costs"];
  featured: boolean;
  signIn: string;
  authenticated: boolean;
}) {
  const t = useTranslations("Pricing");
  const format = useFormatter();

  const price = plan.amountCents;
  const free = price === null;
  const grant = plan.monthly > 0 ? plan.monthly : plan.welcome;
  const worlds = costs.worldGeneration > 0 ? Math.floor(grant / costs.worldGeneration) : 0;
  const turns = costs.turn > 0 ? grant - costs.worldGeneration : 0;

  return (
    <div
      // Deux fonds, pas deux bordures de couleurs différentes sur la même
      // propriété : la variante pose sa propre valeur plutôt que de compter
      // sur le socle, que la feuille arbitrerait.
      className={[
        "flex flex-col rounded-card border p-6",
        featured ? "border-accent bg-mist" : "border-line bg-abyss",
      ].join(" ")}
    >
      <h3 className="font-voice text-subtitle text-vellum">{plan.name}</h3>

      <p className="mt-3 flex items-baseline gap-x-2">
        <span className="font-voice text-display-compact text-vellum">
          {price === null
            ? t("freePrice")
            : format.number(price / 100, {
                style: "currency",
                currency: plan.currency,
              })}
        </span>
        {!free ? (
          <span className="text-caption text-vellum-3">{t("perMonth")}</span>
        ) : null}
      </p>

      <p className="mt-4 text-ui-sm text-vellum-2">
        {plan.monthly > 0
          ? t("grantMonthly", { credits: plan.monthly })
          : t("grantOnce", { credits: plan.welcome })}
      </p>

      <ul className="mt-6 flex-1 space-y-2 border-t border-line pt-6 text-ui-sm text-vellum-2">
        <Highlight>{t("highlightWorlds", { worlds })}</Highlight>
        <Highlight>{t("highlightTurns", { turns: Math.max(0, turns) })}</Highlight>
        <Highlight>
          {plan.monthly > 0 ? t("highlightRenews") : t("highlightOnce")}
        </Highlight>
      </ul>

      <div className="mt-6">
        {plan.purchasable ? (
          <Button
            as={Link}
            href="/compte"
            variant={featured ? "primary" : "secondary"}
            className="w-full"
          >
            {t("choose")}
          </Button>
        ) : free && !authenticated ? (
          <Button as="a" href={signIn} variant="secondary" className="w-full">
            {t("start")}
          </Button>
        ) : (
          // Un palier sans prix configuré n'existe pas : on le dit plutôt que
          // d'offrir un bouton qui répondrait 503.
          <p className="text-caption text-vellum-3">{t("soon")}</p>
        )}
      </div>
    </div>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-x-3">
      <CheckIcon
        aria-hidden="true"
        className="mt-0.5 size-4 flex-none text-accent"
      />
      {children}
    </li>
  );
}

/**
 * Le comparatif, dans un seul tableau qui défile plutôt qu'en deux structures.
 * Le kit autorise un tableau plus large que la page à condition qu'il porte
 * son propre défilement : la page, elle, ne défile jamais de côté.
 */
function Comparison({
  catalog,
  featured,
}: {
  catalog: BillingCatalog;
  featured: string | undefined;
}) {
  const t = useTranslations("Pricing");
  const { costs, plans } = catalog;

  const rows: { label: string; value: (plan: PlanOffer) => string | boolean }[] = [
    {
      label: t("rowWelcome"),
      value: (plan) => (plan.welcome > 0 ? String(plan.welcome) : false),
    },
    {
      label: t("rowMonthly"),
      value: (plan) => (plan.monthly > 0 ? String(plan.monthly) : false),
    },
    {
      label: t("rowWorlds"),
      value: (plan) => {
        const grant = plan.monthly > 0 ? plan.monthly : plan.welcome;
        const worlds = costs.worldGeneration > 0 ? Math.floor(grant / costs.worldGeneration) : 0;
        return worlds > 0 ? String(worlds) : false;
      },
    },
    { label: t("rowRenews"), value: (plan) => plan.monthly > 0 },
    { label: t("rowCancel"), value: (plan) => plan.amountCents !== null },
  ];

  return (
    <section className="mt-24 sm:mt-32">
      <h2 className="font-voice text-title text-balance text-vellum">
        {t("compareTitle")}
      </h2>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-xl border-collapse text-ui-sm">
          <thead>
            <tr>
              <th scope="col" className="w-1/4 pb-4 text-left font-ui font-medium text-vellum-3">
                <span className="sr-only">{t("compareTitle")}</span>
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className={[
                    "border-t-2 px-4 pt-4 pb-4 text-center font-ui font-medium",
                    plan.id === featured
                      ? "border-accent text-accent"
                      : "border-transparent text-vellum",
                  ].join(" ")}
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-3 pr-4 text-left font-ui font-normal text-vellum-2">
                  {row.label}
                </th>
                {plans.map((plan) => {
                  const value = row.value(plan);
                  return (
                    <td key={plan.id} className="px-4 py-3 text-center text-vellum">
                      {typeof value === "string" ? (
                        value
                      ) : value ? (
                        <>
                          <CheckIcon aria-hidden="true" className="mx-auto size-4 text-accent" />
                          <span className="sr-only">{t("yes")}</span>
                        </>
                      ) : (
                        <>
                          <XMarkIcon aria-hidden="true" className="mx-auto size-4 text-vellum-3" />
                          <span className="sr-only">{t("no")}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
