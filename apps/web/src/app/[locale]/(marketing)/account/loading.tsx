import { useTranslations } from "next-intl";

import { PageSkeleton } from "@/components/ui/skeleton";

// Le vrai titre, puis la forme des cartes que le panneau montre en lisant la session.
export default function AccountLoading() {
  const t = useTranslations("Account");

  return (
    <article className="mx-auto max-w-wrap px-6 pt-28 pb-16 sm:pt-40 sm:pb-24 lg:px-8">
      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum">{t("title")}</h1>
        <p className="mt-6 max-w-measure text-ui text-pretty text-vellum-2">{t("lead")}</p>
      </header>

      <div className="mt-10">
        <PageSkeleton label={t("loading")} />
      </div>
    </article>
  );
}
