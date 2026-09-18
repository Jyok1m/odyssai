import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Les primitives du tableau de bord.
 *
 * Elles n'entrent pas dans `components/ui` : le kit habille le jeu, celles-ci
 * habillent un back-office et n'ont pas à s'y retrouver par inadvertance. Les
 * tokens, eux, sont bien ceux du kit : un seul thème sur tout le site.
 */

export function Page({
  title,
  lead,
  actions,
  children,
}: {
  title: string;
  lead?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-voice text-title text-vellum">{title}</h1>
          {lead ? <p className="mt-1.5 text-ui-sm text-vellum-3">{lead}</p> : null}
        </div>
        {actions}
      </div>

      <div className="mt-8">{children}</div>
    </div>
  );
}

/**
 * Des cartes separees, et non un bloc segmente par des filets.
 *
 * Le motif precedent collait quatre chiffres dans un seul cadre avec un
 * `gap-px` colore : lisible, mais rien ne s'y distinguait et rien n'y etait
 * cliquable. Separees, elles peuvent porter une icone, un lien, et reagir au
 * survol quand elles menent quelque part.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </dl>
  );
}

/** Les teintes d'icone disponibles. Une par nature de chiffre, pas au hasard. */
const STAT_TONES = {
  accent: "bg-accent/12 text-accent",
  brass: "bg-brass/12 text-brass",
  arcane: "bg-arcane/12 text-arcane",
  verdigris: "bg-verdigris/12 text-verdigris",
} as const;

export function Stat({
  name,
  value,
  unit,
  icon,
  tone = "accent",
  href,
}: {
  name: string;
  value: string;
  unit?: string;
  icon?: ReactNode;
  tone?: keyof typeof STAT_TONES;
  /** Rend la carte cliquable. Absent, elle reste un simple chiffre. */
  href?: string;
}) {
  const body = (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className={`inline-flex size-9 shrink-0 items-center justify-center rounded-control ${STAT_TONES[tone]}`}
        >
          {icon}
        </span>
      ) : null}

      <span className="min-w-0">
        <dt className="text-caption text-vellum-3">{name}</dt>
        <dd className="mt-1 flex items-baseline gap-x-2">
          <span className="font-voice text-subtitle text-vellum">{value}</span>
          {unit ? <span className="text-ui-sm text-vellum-3">{unit}</span> : null}
        </dd>
      </span>
    </>
  );

  // Une bordure differente au survol seulement quand la carte mene quelque
  // part : un chiffre qui reagit sans rien faire se lit comme un bouton casse.
  const shell = "flex items-center gap-4 rounded-card border border-line bg-abyss px-4 py-5 sm:px-6";

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      className={`${shell} transition-colors hover:border-accent hover:bg-mist`}
    >
      {body}
    </Link>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-abyss">
      {title ? (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-6">
          <h2 className="font-voice text-ui text-vellum">{title}</h2>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Un tableau reste large : il défile horizontalement dans son propre cadre
 * plutôt que de pousser la page entière, ce qui casserait la mise en page à
 * la largeur d'un téléphone.
 */
export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl text-left whitespace-nowrap">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 font-ui text-caption font-semibold text-vellum-2 sm:px-6 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-ui-sm text-vellum-2 sm:px-6 ${className}`}>
      {children}
    </td>
  );
}

const TONES = {
  neutral: "border-line text-vellum-3",
  accent: "border-accent/50 text-accent",
  warn: "border-brass/50 text-brass",
  danger: "border-ember/50 text-ember",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-tag ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Le statut tel que Stripe le dit, rendu lisible sans le trahir. */
export function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge tone="accent">actif</Badge>;
  if (status === "canceled") return <Badge>résilié</Badge>;
  if (status === "past_due") return <Badge tone="danger">impayé</Badge>;
  return <Badge tone="warn">{status}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-ui-sm text-vellum-3 sm:px-6">{children}</p>;
}

export function Feedback({ error }: { error: string | null }) {
  return (
    <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
      {error}
    </p>
  );
}

/** Les montants viennent de Stripe en centimes : jamais de flottant en base. */
export function money(cents: number | null, currency: string): string {
  if (cents === null) return "offert";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(
    cents / 100,
  );
}

export function date(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Un message par cause : « impossible » ne dit pas laquelle. */
export function reasonOf(caught: unknown): string {
  const code =
    caught && typeof caught === "object" && "code" in caught
      ? String((caught as { code: unknown }).code)
      : "unknown";

  switch (code) {
    case "forbidden":
      return "Ce compte n'administre pas OdyssAI.";
    case "unauthenticated":
      return "La session a expiré. Reconnecte-toi.";
    case "unreachable":
      return "L'API ne répond pas.";
    case "not_found":
      return "Introuvable. La page a peut-être été rechargée trop tard.";
    case "slug_taken":
      return "Ce slug est déjà pris par un autre palier.";
    case "plan_in_use":
      return "Des joueurs portent encore ce palier. Archive-le plutôt que de le supprimer.";
    case "plan_protected":
      return "Le palier libre ne peut être ni archivé ni supprimé : tout y retombe.";
    case "stripe_error":
      return "Stripe a refusé l'opération. Rien n'a été enregistré.";
    case "billing_disabled":
      return "Stripe n'est pas configuré sur cette copie.";
    case "validation_error":
      return "La saisie n'est pas valide.";
    default:
      return "Opération impossible pour le moment.";
  }
}
