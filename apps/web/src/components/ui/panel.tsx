import type { ReactNode } from "react";

/*
  La carte à en-tête en capitales, et la pastille du kit.

  Elles vivent dans le kit et non plus sous `play` : la table, la fiche, le
  monde, les histoires et le compte partagent la même grammaire de blocs, et
  une primitive rangée sous un seul de ses appelants finit recopiée chez les
  autres. Celles du tableau de bord restent à part, elles : `/admin` n'a pas
  next-intl, et ce n'est pas le même habillage.
*/
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title?: ReactNode;
  // À droite du titre : un compte, une précision, un lien.
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "rounded-card border border-line bg-abyss p-5 sm:p-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title ? (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
            {title}
          </h2>
          {aside ? <span className="text-caption text-vellum-3">{aside}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/*
  Les tons du kit. `accent` suit le monde courant, les autres sont fixes :
  une pastille de danger ne change pas de couleur en changeant de monde.
*/
const TONES = {
  accent: "border-accent/45 bg-accent/10 text-accent",
  brass: "border-brass/45 bg-brass/10 text-brass",
  arcane: "border-arcane/45 bg-arcane/10 text-arcane",
  ember: "border-ember/45 bg-ember/10 text-ember",
  muted: "border-line text-vellum-2",
} as const;

export function Tag({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-tag font-medium whitespace-nowrap",
        TONES[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/*
  Une paire terme / valeur, en deux colonnes. C'est la forme des blocs
  « Essence » et « Incarnation » de la fiche, et celle du glossaire.
*/
export function Definition({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-5 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-ui-sm text-vellum-3">{term}</dt>
      <dd className="text-ui-sm text-pretty text-vellum">{children}</dd>
    </div>
  );
}
