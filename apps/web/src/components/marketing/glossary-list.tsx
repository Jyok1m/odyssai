export type GlossaryEntry = {
  term: string;
  meaning: string;
};

/**
 * Une liste de définitions et non un tableau : c'est la sémantique juste
 * pour un glossaire, et deux colonnes de prose se lisent mal sur mobile.
 */
export function GlossaryList({ entries }: { entries: GlossaryEntry[] }) {
  return (
    <dl className="mt-14 max-w-headline divide-y divide-line overflow-hidden rounded-card border border-line">
      {entries.map((entry) => (
        <div
          key={entry.term}
          className="grid gap-1 p-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6"
        >
          <dt className="font-ui text-ui-sm font-semibold text-vellum">
            {entry.term}
          </dt>
          <dd className="font-voice text-ui text-pretty text-vellum-2">
            {entry.meaning}
          </dd>
        </div>
      ))}
    </dl>
  );
}
