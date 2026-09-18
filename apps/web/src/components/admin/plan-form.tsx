"use client";

import type { AdminPlan, CreatePlanRequest, UpdatePlanRequest } from "@odyssai/schemas";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";

interface Props {
  /** `null` pour une création. */
  plan: AdminPlan | null;
  onCancel: () => void;
  onSubmit: (values: CreatePlanRequest | UpdatePlanRequest) => Promise<void>;
}

/**
 * Le formulaire d'un palier.
 *
 * Le slug ne s'édite qu'à la création : il est écrit dans chaque abonnement et
 * dans le grand livre, et le changer réécrirait l'histoire. La devise non plus,
 * un prix Stripe portant la sienne.
 */
export function PlanForm({ plan, onCancel, onSubmit }: Props) {
  const [slug, setSlug] = useState(plan?.slug ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [monthly, setMonthly] = useState(String(plan?.monthlyCredits ?? 100));
  const [welcome, setWelcome] = useState(String(plan?.welcomeCredits ?? 0));
  const [amount, setAmount] = useState(
    plan?.amountCents !== null && plan?.amountCents !== undefined
      ? (plan.amountCents / 100).toFixed(2)
      : "",
  );
  const [order, setOrder] = useState(String(plan?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);

  const creating = plan === null;
  const priced = amount.trim().length > 0;

  const submit = async () => {
    setBusy(true);

    try {
      // Les centimes plutôt que les euros : un montant en flottant dérive, et
      // c'est en centimes que Stripe facture.
      const amountCents = priced
        ? Math.round(Number.parseFloat(amount.replace(",", ".")) * 100)
        : null;

      const shared = {
        name: name.trim(),
        monthlyCredits: Number.parseInt(monthly, 10),
        welcomeCredits: Number.parseInt(welcome, 10),
        amountCents,
        sortOrder: Number.parseInt(order, 10),
      };

      await onSubmit(
        creating
          ? { ...shared, slug: slug.trim(), currency: "eur" }
          : shared,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      data-focus-ring="container"
      className="rounded-card border border-line bg-abyss p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="font-voice text-ui text-vellum">
        {creating ? "Nouveau palier" : `Modifier ${plan.name}`}
      </h2>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          id="slug"
          label="Slug"
          hint={
            creating
              ? "Minuscules, chiffres et tirets. Définitif."
              : "Définitif : il est écrit dans chaque abonnement."
          }
        >
          <input
            id="slug"
            value={slug}
            disabled={!creating}
            placeholder="arpenteur"
            onChange={(event) => setSlug(event.target.value)}
            className={`${FIELD} disabled:opacity-50`}
          />
        </Field>

        <Field id="name" label="Nom affiché">
          <input
            id="name"
            value={name}
            placeholder="Arpenteur"
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </Field>

        <Field
          id="amount"
          label="Montant mensuel"
          hint={priced ? "En euros. Vide : palier offert." : "Vide : palier offert, rien chez Stripe."}
        >
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            placeholder="12.00"
            onChange={(event) => setAmount(event.target.value)}
            className={FIELD}
          />
        </Field>

        <Field id="monthly" label="Crédits par mois">
          <input
            id="monthly"
            type="number"
            inputMode="numeric"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
            className={FIELD}
          />
        </Field>

        <Field
          id="welcome"
          label="Crédits de bienvenue"
          hint="Accordés une seule fois, à l'ouverture du compte."
        >
          <input
            id="welcome"
            type="number"
            inputMode="numeric"
            value={welcome}
            onChange={(event) => setWelcome(event.target.value)}
            className={FIELD}
          />
        </Field>

        <Field id="order" label="Ordre d'affichage">
          <input
            id="order"
            type="number"
            inputMode="numeric"
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            className={FIELD}
          />
        </Field>
      </div>

      {priced ? (
        <p className="mt-4 max-w-prose text-caption text-brass">
          {creating
            ? "Le produit et le prix seront créés chez Stripe avec ta clé."
            : "Changer le montant crée un nouveau prix chez Stripe et désactive l'ancien. Les abonnés en cours gardent le leur jusqu'à leur prochaine facture."}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !name.trim() || (creating && !slug.trim())}>
          {busy ? "Enregistrement." : creating ? "Créer" : "Enregistrer"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-vellum-3">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-caption text-vellum-3">{hint}</p> : null}
    </div>
  );
}
