import { Loading, Skeleton } from "@/components/ui/skeleton";

// Dans la coquille du tableau de bord, qui reste : un titre, puis des cartes.
export default function AdminLoading() {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <Loading label="Chargement.">
        <Skeleton className="h-8 w-56 max-w-full" />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" round="card" />
          <Skeleton className="h-28" round="card" />
          <Skeleton className="h-28" round="card" />
          <Skeleton className="h-28" round="card" />
        </div>
      </Loading>
    </div>
  );
}
