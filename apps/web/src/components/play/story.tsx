"use client";

import type { TurnMessage } from "@odyssai/schemas";
import { useTranslations } from "next-intl";

/*
  Le récit seul, sans les phrases du joueur : ce qu'on relit d'une partie,
  c'est l'histoire, pas ses propres commandes.

  Les mêmes messages que le fil, filtrés ici et non redemandés : `GET /turn`
  les rend déjà tous. Même échelle que lui aussi : c'est le même texte, et le
  relire ne doit pas donner l'impression d'un autre document.
*/
export function Story({ messages }: { messages: TurnMessage[] }) {
  const t = useTranslations("Game");

  const scenes = messages.filter(
    (message) => message.role === "assistant" && message.content.trim(),
  );

  if (scenes.length === 0) {
    return <p className="text-ui-sm text-vellum-3">{t("storyEmpty")}</p>;
  }

  return (
    <div className="flex max-h-128 flex-col gap-6 overflow-y-auto overscroll-contain px-1">
      {scenes.map((scene, index) => (
        <article key={scene.id}>
          {index > 0 ? <hr className="mb-6 border-line" /> : null}
          {/* La lettrine sur la première scène seule : celle-là commence
              l'histoire, les autres la continuent. */}
          <p
            className={[
              "font-voice text-narration whitespace-pre-wrap text-vellum",
              index === 0 ? "dropcap" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {scene.content}
          </p>
        </article>
      ))}
    </div>
  );
}
