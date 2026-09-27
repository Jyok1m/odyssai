import { useTranslations } from "next-intl";

import { SheetFallback } from "@/components/play/page-skeletons";

export default function CharacterLoading() {
  const t = useTranslations("Sheet");

  return <SheetFallback label={t("loading")} />;
}
