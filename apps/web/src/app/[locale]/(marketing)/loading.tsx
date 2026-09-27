import { useTranslations } from "next-intl";

import { Loading, Skeleton, SkeletonLines } from "@/components/ui/skeleton";

/*
  Entre deux pages du site, sous le bandeau et au-dessus du pied, qui
  restent : la colonne d'une page de contenu, titre puis paragraphes, aux
  marges de `ProsePage`. Les pages sont statiques et le plus souvent déjà
  préchargées, cette forme ne se voit que sur un réseau lent.
*/
export default function MarketingLoading() {
  const t = useTranslations("Nav");

  return (
    <article className="mx-auto max-w-wrap px-6 pt-28 pb-16 sm:pt-40 sm:pb-24 lg:px-8">
      <Loading label={t("loading")} className="max-w-headline">
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="mt-8 h-6 w-3/5" />
        <SkeletonLines lines={4} className="mt-14" />
        <SkeletonLines lines={3} className="mt-8" />
      </Loading>
    </article>
  );
}
