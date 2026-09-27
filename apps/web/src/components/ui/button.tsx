import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { SpinnerIcon } from "./spinner";

/*
  Variantes .btn du kit. Chaque variante fixe sa propre couleur de bordure :
  deux utilitaires de `border-color` sur le même élément sont arbitrés par
  l'ordre dans la feuille CSS, pas par l'ordre dans className.
*/
const VARIANTS = {
  primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border-line text-vellum hover:border-vellum-3 hover:bg-mist",
  ghost: "border-transparent text-vellum-2 hover:bg-mist hover:text-vellum",
  danger: "border-ember/55 text-ember hover:bg-ember/12",
} as const;

const SIZES = {
  md: "h-10 px-4.5 text-control",
  sm: "h-8 px-3 text-ui-sm",
} as const;

/*
  150 ms comme le kit. L'appui enfonce le bouton d'un cran, sauf mouvement
  réduit ; désactivé, il pâlit, sinon il se lit comme un bouton qui ne répond
  pas. `not-disabled` et non `enabled` : un lien habillé en bouton n'est ni
  l'un ni l'autre, et doit s'enfoncer aussi.

  `touch-target` porte la cible a 44 px au doigt : `md` fait 40 px et `sm`
  32, les tailles du kit, que le tactile ne change pas a l'oeil.

  Occupé (`busy`), il est désactivé, un second appui ne part pas, mais il ne
  pâlit pas : un cercle tourne devant son libellé, il travaille.
*/
const BASE =
  "touch-target inline-flex items-center justify-center gap-2 rounded-control border font-ui font-medium whitespace-nowrap transition duration-quick ease-out motion-safe:active:not-disabled:scale-97 not-aria-busy:disabled:opacity-50";

type ButtonProps<T extends ElementType> = {
  as?: T;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  busy?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "variant" | "size" | "busy" | "className" | "children"
>;

export function Button<T extends ElementType = "button">({
  as,
  variant = "primary",
  size = "md",
  busy = false,
  className,
  children,
  ...props
}: ButtonProps<T>) {
  const Component = (as ?? "button") as ElementType;

  return (
    <Component
      className={[BASE, VARIANTS[variant], SIZES[size], className]
        .filter(Boolean)
        .join(" ")}
      {...props}
      {...(busy ? { disabled: true, "aria-busy": true } : {})}
    >
      {busy ? <SpinnerIcon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : null}
      {children}
    </Component>
  );
}
