import type { ReactNode } from "react";

export type ProseSection = {
  title: string;
  body: string[];
};

/**
 * Gabarit des pages de contenu. Purement présentationnel : chaque page lit
 * ses propres messages et passe le texte résolu, ce qui évite un namespace
 * dynamique et garde le typage des clés.
 *
 * La prose est en Literata : c'est la voix du narrateur, et l'axe optique du
 * kit est pensé pour la lecture à l'écran.
 */
export function ProsePage({
  title,
  lead,
  intro,
  sections,
  footer,
}: {
  title: string;
  lead: string;
  intro: string[];
  sections: ProseSection[];
  footer?: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum sm:text-display">
          {title}
        </h1>
        <p className="mt-8 font-voice text-tagline text-pretty text-vellum-2 italic">
          {lead}
        </p>
      </header>

      <div className="mt-14 max-w-headline space-y-6 font-voice text-narration text-pretty text-vellum">
        {intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {sections.map((section) => (
        <section key={section.title} className="mt-16 max-w-headline">
          <h2 className="font-voice text-subtitle text-vellum">
            {section.title}
          </h2>
          <div className="mt-4 space-y-6 font-voice text-narration text-pretty text-vellum">
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}

      {footer ? <div className="mt-16 max-w-headline">{footer}</div> : null}
    </article>
  );
}
