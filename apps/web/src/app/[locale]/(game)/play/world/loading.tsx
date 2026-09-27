import { useTranslations } from "next-intl";

import { SheetFallback } from "@/components/play/page-skeletons";

export default function WorldLoading() {
  const t = useTranslations("WorldBook");

  return <SheetFallback label={t("loading")} />;
}
