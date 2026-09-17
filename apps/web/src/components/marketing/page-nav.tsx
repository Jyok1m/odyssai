"use client";

import { useEffect, useState } from "react";

export type NavSection = { id: string; title: string };

/**
 * Sommaire de la page, dans la colonne de droite. Client uniquement pour la
 * section courante : le reste de `ProsePage` doit rester rendu au serveur.
 */
export function PageNav({
  label,
  sections,
}: {
  label: string;
  sections: NavSection[];
}) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const headings = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    // Une bande étroite en haut de la fenêtre : le titre le plus haut à
    // l'intérieur gagne. Sans cette marge basse, toutes les sections visibles
    // se disputeraient l'état actif en bas de page.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        // Rien dans la bande : on garde la dernière section connue plutôt que
        // de vider le surlignage entre deux titres.
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );

    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label={label} className="hidden lg:block">
      <div className="sticky top-24">
        <p className="text-tag font-medium tracking-wide text-vellum-3 uppercase">
          {label}
        </p>
        <ul className="mt-4 space-y-1 border-l border-line">
          {sections.map((section) => {
            const current = section.id === active;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={current ? "true" : undefined}
                  className={[
                    "-ml-px block border-l py-1.5 pl-4 text-ui-sm transition-colors",
                    current
                      ? "border-accent text-accent"
                      : "border-transparent text-vellum-3 hover:border-vellum-3 hover:text-vellum-2",
                  ].join(" ")}
                >
                  {section.title}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
