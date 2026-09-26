"use client";

import { Fragment, useState } from "react";

/*
  Un texte diffusé, dont chaque fragment arrive en fondu, comme l'encre qui
  prend sur la page. Le flux ne change pas : l'appelant passe le texte entier
  à chaque rendu, ce composant retrouve ce qui vient d'arriver.

  Les fragments les plus anciens sont refondus en un seul nœud texte : un
  récit de deux mille mots ne laisse pas deux mille `span` derrière lui. Les
  clés sont les positions de départ, stables d'une fusion à l'autre, pour que
  rien ne se remonte ni ne se rejoue.
*/
type Chunk = { at: number; text: string; settled: boolean };

// Au-delà de MERGE_FROM fragments, seuls les KEEP derniers restent à part.
const MERGE_FROM = 32;
const KEEP = 12;

export function StreamedText({ text, live = false }: { text: string; live?: boolean }) {
  const [source, setSource] = useState(text);
  // Arrivé déjà écrit (l'historique), le texte se pose sans fondu.
  const [chunks, setChunks] = useState<Chunk[]>(
    text ? [{ at: 0, text, settled: !live }] : [],
  );

  if (text !== source) {
    setSource(text);
    setChunks(next(chunks, source, text));
  }

  return (
    <>
      {chunks.map((chunk) =>
        chunk.settled ? (
          <Fragment key={chunk.at}>{chunk.text}</Fragment>
        ) : (
          <span key={chunk.at} className="animate-ink">
            {chunk.text}
          </span>
        ),
      )}
    </>
  );
}

function next(chunks: Chunk[], before: string, after: string): Chunk[] {
  // Un texte remplacé plutôt que prolongé repart d'un seul bloc posé.
  if (!after.startsWith(before)) return [{ at: 0, text: after, settled: true }];

  const grown = [...chunks, { at: before.length, text: after.slice(before.length), settled: false }];
  if (grown.length <= MERGE_FROM) return grown;

  const old = grown.slice(0, grown.length - KEEP);
  return [
    { at: 0, text: old.map((chunk) => chunk.text).join(""), settled: true },
    ...grown.slice(grown.length - KEEP),
  ];
}
