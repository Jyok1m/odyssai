import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Loading, PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";

/*
  Les formes d'attente des pages de jeu, partagées par leur `loading.tsx` et
  par `GameGate` tant que la phase de l'alpha n'est pas lue : la même
  colonne, les mêmes marges, le vrai titre quand il ne dépend de rien. Ce
  qui arrive se pose dessus sans que rien ne saute.
*/
export function PlayFrame({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto max-w-wrap px-6 pt-4 pb-16 sm:pt-40 sm:pb-24 lg:px-8">
      {children}
    </article>
  );
}

export function StoriesHeader() {
  const t = useTranslations("Stories");

  return (
    <header className="max-w-headline">
      <h1 className="font-voice text-display-compact text-balance text-vellum">{t("title")}</h1>
      <p className="mt-4 max-w-measure text-ui text-pretty text-vellum-2">{t("lead")}</p>
    </header>
  );
}

// Le retour à la table, en tête de la fiche et du livre du monde.
export function BackToTable() {
  const t = useTranslations("Sheet");

  return (
    <Link
      href="/play"
      className="touch-target font-ui text-control font-medium text-vellum-2 transition-colors hover:text-vellum"
    >
      <span aria-hidden="true">&larr;</span> {t("back")}
    </Link>
  );
}

// La forme de l'assistant, titre à gauche et fil d'étapes à droite.
export function WizardSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="w-full max-w-headline space-y-4">
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-4 w-full max-w-measure" />
        </div>
        <Skeleton className="h-5 w-full max-w-64" />
      </div>
      <Skeleton className="h-72" round="card" />
    </Loading>
  );
}

// Trois cartes à la place de la grille des histoires.
export function StoriesSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton className="h-72 sm:col-span-2 lg:col-span-1 lg:row-span-2 lg:h-auto" round="card" />
      <Skeleton className="h-64" round="card" />
      <Skeleton className="h-64" round="card" />
    </Loading>
  );
}

export function TableFallback() {
  const t = useTranslations("Play");

  return (
    <PlayFrame>
      <WizardSkeleton label={t("loading")} />
    </PlayFrame>
  );
}

export function StoriesFallback() {
  const t = useTranslations("Stories");

  return (
    <PlayFrame>
      <StoriesHeader />
      <div className="mt-8">
        <StoriesSkeleton label={t("loading")} />
      </div>
    </PlayFrame>
  );
}

// La fiche et le livre du monde : le retour, puis une page de panneaux.
export function SheetFallback({ label }: { label: string }) {
  return (
    <PlayFrame>
      <BackToTable />
      <div className="mt-8">
        <PageSkeleton label={label} />
      </div>
    </PlayFrame>
  );
}
