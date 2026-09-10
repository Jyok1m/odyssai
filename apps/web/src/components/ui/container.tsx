import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type ContainerProps<T extends ElementType> = {
	/** Balise ou composant à rendre. `div` par défaut. */
	as?: T;
	className?: string;
	children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/**
 * Container global : borne la largeur du contenu et gère les gouttières
 * responsives. Reprend le `.wrap` du kit (1120 px). N'apporte aucun style
 * au-delà de ça.
 */
export function Container<T extends ElementType = "div">({
	as,
	className,
	...props
}: ContainerProps<T>) {
	const Component = (as ?? "div") as ElementType;

	return (
		<Component
			className={["mx-auto max-w-wrap px-6 lg:px-8", className]
				.filter(Boolean)
				.join(" ")}
			{...props}
		/>
	);
}
