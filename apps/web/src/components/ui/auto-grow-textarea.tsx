"use client";

import {
  useLayoutEffect,
  useRef,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";

/*
  Un champ de conversation qui grandit avec le texte, jusqu'à une hauteur
  bornée, puis défile.

  Trois champs faisaient chacun leur cuisine : un seul grandissait, les deux
  autres restaient sur une ligne et montraient un ascenseur dès la deuxième,
  et Safari y ajoutait un ascenseur horizontal quand le vertical mangeait de
  la largeur. La hauteur est remise à zéro avant d'être mesurée, sinon
  `scrollHeight` ne redescend jamais quand on efface.
*/
const MAX_PX = 160;

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  // Pour que l'appelant puisse rendre le focus au champ.
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
};

export function AutoGrowTextarea({ value, fieldRef, className, ...rest }: Props) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const ref = fieldRef ?? inner;

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, MAX_PX)}px`;
    field.style.overflowY = field.scrollHeight > MAX_PX ? "auto" : "hidden";
  }, [value, ref]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={[
        "block w-full min-w-0 resize-none self-center overflow-x-hidden border-0 bg-transparent py-1.5 font-ui text-ui-sm leading-6 text-vellum placeholder:text-vellum-3",
        className ?? "",
      ].join(" ")}
      {...rest}
    />
  );
}
