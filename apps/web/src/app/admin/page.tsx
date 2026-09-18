import { AlphaView } from "@/components/admin/alpha-view";
import { OverviewView } from "@/components/admin/overview-view";

export default function AdminOverviewPage() {
  return (
    <>
      <OverviewView />
      {/* Sous les chiffres : c'est un reglage, pas une mesure, mais il vit sur
          le premier ecran parce qu'il decide de ce que voient les visiteurs. */}
      <div className="px-4 pb-10 sm:px-6 lg:px-8">
        <AlphaView />
      </div>
    </>
  );
}
