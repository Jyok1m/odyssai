import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

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
*/
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control border font-ui font-medium whitespace-nowrap transition duration-quick ease-out motion-safe:active:not-disabled:scale-97 disabled:opacity-50";

type ButtonProps<T extends ElementType> = {
  as?: T;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  children?: ReactNode;
} & Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "variant" | "size" | "className" | "children"
>;

export function Button<T extends ElementType = "button">({
  as,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps<T>) {
  const Component = (as ?? "button") as ElementType;

  return (
    <Component
      className={[BASE, VARIANTS[variant], SIZES[size], className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
