import type { ReactNode } from "react";

/*
  Une étape du parcours, en carte.

  Le rang est porté par une pastille : cochée quand l'étape est derrière,
  cerclée quand c'est celle qu'on remplit. Le joueur sait ainsi où il en est
  sans remonter au fil d'étapes, qui le dit une seconde fois en haut de page.

  La question est en serif et posée à la deuxième personne : c'est quelqu'un
  qui demande, pas un formulaire qui réclame.
*/
export function StepCard({
  rank,
  label,
  title,
  aside,
  done = false,
  children,
}: {
  rank: number;
  label: string;
  title: string;
  // À droite de l'en-tête : un compte, un état, un réglage.
  aside?: ReactNode;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={[
                "flex size-6 items-center justify-center rounded-full border text-tag",
                done
                  ? "border-accent bg-accent text-on-accent"
                  : "border-accent text-accent",
              ].join(" ")}
            >
              {done ? "✓" : rank}
            </span>
            <span className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
              {label}
            </span>
          </p>
          {aside}
        </div>

        <h2 className="mt-4 font-voice text-title text-balance text-vellum">
          {title}
        </h2>
      </header>

      <div className="mt-5">{children}</div>
    </section>
  );
}
