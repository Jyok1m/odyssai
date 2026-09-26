"use client";

import { useEffect, useState } from "react";

/*
  Une liste qui sait qui arrive et qui s'en va.

  Ce qui arrive après le premier rendu est marqué `enter` : ce qui était là
  à l'ouverture ne rejoue pas son entrée. Ce qui s'en va reste `leave` le
  temps de sa sortie, à son ancien rang, puis disparaît.

  La comparaison se fait sur les clés, pas sur l'identité du tableau : un
  appelant peut passer une liste dérivée à chaque rendu (un `slice`, un
  `reverse`) sans relancer quoi que ce soit.
*/
export type Presence = "idle" | "enter" | "leave";

// La durée de `animate-leave`, `--motion-base`.
const EXIT_MS = 220;

type Gone<T> = { key: string; item: T; index: number };

export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { key: string; item: T; presence: Presence }[] {
  const keys = items.map(keyOf);
  const signature = keys.join("\u0000");

  const [initial] = useState(() => new Set(keys));
  const [last, setLast] = useState({ signature, items });
  const [gone, setGone] = useState<Gone<T>[]>([]);

  if (signature !== last.signature) {
    const present = new Set(keys);
    const removed = last.items
      .map((item, index) => ({ key: keyOf(item), item, index }))
      .filter((entry) => !present.has(entry.key));

    setLast({ signature, items });
    setGone((current) => [...current.filter((entry) => !present.has(entry.key)), ...removed]);
  }

  useEffect(() => {
    if (gone.length === 0) return;
    const leaving = new Set(gone.map((entry) => entry.key));
    const timer = setTimeout(
      () => setGone((current) => current.filter((entry) => !leaving.has(entry.key))),
      EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [gone]);

  const shown: { key: string; item: T; presence: Presence }[] = items.map((item, index) => ({
    key: keys[index]!,
    item,
    presence: initial.has(keys[index]!) ? "idle" : "enter",
  }));

  for (const entry of gone) {
    if (keys.includes(entry.key)) continue;
    shown.splice(Math.min(entry.index, shown.length), 0, {
      key: entry.key,
      item: entry.item,
      presence: "leave",
    });
  }

  return shown;
}

// La classe qui va avec : une entrée qui monte, une sortie qui s'efface.
export function presenceClass(presence: Presence) {
  if (presence === "enter") return "animate-rise";
  if (presence === "leave") return "pointer-events-none animate-leave";
  return "";
}
