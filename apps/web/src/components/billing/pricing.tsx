"use client";

import { CheckIcon, StarIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { BillingCatalog, PlanOffer } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useSession } from "@/components/auth/session-provider";
import { useAuthLinks } from "@/components/auth/auth-links";
import { Button } from "@/components/ui/button";
import {
  BillingError,
  fetchBillingSummary,
  fetchCatalog,
  startCheckout,
} from "@/lib/billing";

/*
  La grille des paliers, le comparatif et la foire aux questions.

  Tout vient de `GET /billing/catalog`, public et sans session : le barème n'a
  rien de personnel, et un visiteur doit voir les prix avant de s'inscrire.

  **Rien n'est écrit en dur ici**, ni un nom de palier, ni un montant, ni une
  dotation. Les paliers se créent au tableau de bord et leurs noms ne sont pas
  connus à la compilation ; les montants vivent chez Stripe, les recopier
  ferait deux vérités. Même les lignes du comparatif se déduisent des
  chiffres, pour qu'un palier ajouté demain s'y range sans qu'on y touche.
*/
export function Pricing() {
  const t = useTranslations("Pricing");
  const session = useSession();
  const { signIn } = useAuthLinks();

  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
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

  // Le palier du visiteur, pour le marquer dans la grille. Un appel de plus,
  // et seulement pour qui est connecte : la page reste lisible sans session,
  // et un echec ne retire rien puisqu'il n'y a alors rien a marquer.
  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();

    fetchBillingSummary(controller.signal)
      .then((summary) => setCurrent(summary.plan))
      .catch(() => undefined);

    return () => controller.abort();
  }, [session.status]);

  if (failed) {
    return <p className="mt-10 text-ui-sm text-ember">{t("error")}</p>;
  }

  if (!catalog) {
    return <p className="mt-10 text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  // La vedette vient de la base : elle se pose au tableau de bord, la table
  // n'en laisse qu'une, et elle ne se déplace plus toute seule le jour où un
  // palier s'ajoute.
  const featured = catalog.plans.find((plan) => plan.recommended)?.id;

  // Lu plutôt qu'efface a la deconnexion : remettre l'etat a zero depuis
  // l'effet declencherait un rendu en cascade, que la regle react-hooks
  // refuse a juste titre.
  const mine = session.status === "authenticated" ? current : null;

  return (
    <>
      {/* Une colonne par palier des que la place existe. `max-w-md` centre la
          pile sur telephone : etiree sur toute la largeur, une carte seule
          par ligne devient un bandeau. */}
      <div className="mx-auto mt-16 grid max-w-md grid-cols-1 gap-5 sm:max-w-none sm:grid-cols-2 lg:grid-cols-4">
        {catalog.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            costs={catalog.costs}
            featured={plan.id === featured}
            current={plan.id === mine}
            signIn={signIn}
            authenticated={session.status === "authenticated"}
          />
        ))}
      </div>

      <Comparison catalog={catalog} featured={featured} />

      <section className="mt-24 sm:mt-32">
        <h2 className="text-center font-voice text-title text-balance text-vellum">
          {t("faqTitle")}
        </h2>
        <dl className="mx-auto mt-12 max-w-4xl divide-y divide-line">
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

      <p className="mt-16 text-center text-caption text-vellum-3">
        {t("costsNote", {
          turn: catalog.costs.turn,
          world: catalog.costs.worldGeneration,
        })}
      </p>
    </>
  );
}

// Une carte de palier. Tout son contenu se déduit des chiffres du catalogue.
function PlanCard({
  plan,
  costs,
  featured,
  current,
  signIn,
  authenticated,
}: {
  plan: PlanOffer;
  costs: BillingCatalog["costs"];
  featured: boolean;
  current: boolean;
  signIn: string;
  authenticated: boolean;
}) {
  const t = useTranslations("Pricing");
  const format = useFormatter();
  const [leaving, setLeaving] = useState(false);

  /*
    Une navigation de premier niveau, jamais un fetch : la page de Stripe
    refuse d'être chargée en second plan. La session est obligatoire pour
    ouvrir un paiement, d'où le passage par la connexion pour un visiteur
    anonyme, qui revient ensuite sur cette page.
  */
  const choose = async () => {
    setLeaving(true);
    try {
      window.location.assign(await startCheckout(plan.id));
    } catch (caught: unknown) {
      const disabled =
        caught instanceof BillingError && caught.code === "billing_disabled";
      toast.error(t(disabled ? "checkoutDisabled" : "checkoutError"));
      setLeaving(false);
    }
  };

  const price = plan.amountCents;
  const free = price === null;
  const grant = plan.monthly > 0 ? plan.monthly : plan.welcome;
  const worlds = costs.worldGeneration > 0 ? Math.floor(grant / costs.worldGeneration) : 0;
  const turns = costs.turn > 0 ? grant - costs.worldGeneration : 0;

  // Trois états possibles, et un seul l'emporte : le palier qu'on a déjà prime
  // sur celui qu'on recommande, sans quoi on mettrait en avant un achat que le
  // visiteur a déjà fait. Chaque variante pose sa propre bordure et son propre
  // fond : deux utilitaires sur la même propriété sont arbitrés par la feuille
  // de style, pas par l'ordre dans className.
  const skin = current
    ? "border-verdigris bg-mist"
    : featured
      ? "border-accent bg-mist"
      : "border-line bg-abyss";

  return (
    <div className={`flex flex-col rounded-card border p-6 ${skin}`}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="font-voice text-subtitle text-vellum">{plan.name}</h3>

        {current ? (
          <span className="rounded-control border border-verdigris px-2 py-0.5 text-tag font-medium text-verdigris">
            {t("yourPlan")}
          </span>
        ) : featured ? (
          <span className="inline-flex items-center gap-1 rounded-control bg-accent px-2 py-0.5 text-tag font-medium text-on-accent">
            <StarIcon aria-hidden="true" className="size-3.5" />
            {t("recommended")}
          </span>
        ) : null}
      </div>

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

      {/* Deux lignes reservees : « une seule fois » fait passer la phrase a la
          ligne sur le palier offert, et sans hauteur minimale la barre de
          separation ne tombait pas au meme endroit d'une carte a l'autre. */}
      <p className="mt-4 min-h-11 text-ui-sm text-vellum-2">
        {plan.monthly > 0
          ? t("grantMonthly", { credits: plan.monthly })
          : t("grantOnce", { credits: plan.welcome })}
      </p>

      <ul className="mt-6 flex-1 space-y-2 border-t border-line pt-6 text-ui-sm text-vellum-2">
        <Highlight>
          {worlds > 0
            ? t("highlightWorldThenTurns", { turns: Math.max(0, turns) })
            : t("highlightTurnsOnly", { turns: grant })}
        </Highlight>
        <Highlight>
          {plan.monthly > 0 ? t("highlightRenews") : t("highlightOnce")}
        </Highlight>
      </ul>

      <div className="mt-6">
        {current ? (
          <p className="text-caption text-vellum-3">{t("currentNote")}</p>
        ) : plan.purchasable && authenticated ? (
          <Button
            variant={featured ? "primary" : "secondary"}
            className="w-full"
            disabled={leaving}
            onClick={() => void choose()}
          >
            {leaving ? t("leaving") : t("choose")}
          </Button>
        ) : plan.purchasable ? (
          // Sans session il n'y a pas de paiement a ouvrir : on passe par la
          // connexion, qui ramene ici.
          <Button
            as="a"
            href={signIn}
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
          // Sans prix configuré ou mis en attente au tableau de bord : on
          // l'annonce plutôt que d'offrir un bouton qui répondrait 503.
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

/*
  Le comparatif, dans un seul tableau qui défile plutôt qu'en deux structures.
  Le kit autorise un tableau plus large que la page à condition qu'il porte
  son propre défilement : la page, elle, ne défile jamais de côté.
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
      <h2 className="text-center font-voice text-title text-balance text-vellum">
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
