"use client";

import { ArrowDownTrayIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import toast from "react-hot-toast";

import { reasonOf } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { fetchMarketingEmails } from "@/lib/admin";

/*
  L'extraction des adresses consenties. Le fichier est fabriqué ici depuis la
  réponse JSON : un point d'API qui rendrait un fichier demanderait une
  navigation de premier niveau, donc de sortir le cookie de son
  `credentials: include`.

  L'API ne sait rendre que ceux qui ont consenti, aucun paramètre ne demande
  les autres.
*/
export function MarketingExport() {
  const [busy, setBusy] = useState(false);

  const extract = async () => {
    setBusy(true);
    try {
      const list = await fetchMarketingEmails();

      if (list.count === 0) {
        toast("Personne n'a encore consenti.");
        return;
      }

      // Une adresse par ligne, avec un en-tete : c'est ce qu'attend n'importe
      // quel outil d'envoi, et ca se relit sans tableur.
      const csv = ["email", ...list.emails].join("\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = `odyssai-consentements-${list.extractedAt.slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`${list.count} adresse${list.count > 1 ? "s" : ""} sur ${list.total}.`);
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={() => void extract()}
    >
      <ArrowDownTrayIcon aria-hidden="true" className="size-4" />
      {busy ? "Extraction." : "Extraire les adresses consenties"}
    </Button>
  );
}
