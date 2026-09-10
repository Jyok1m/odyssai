/**
 * Drapeaux de fonctionnalité, lus côté navigateur : ils portent donc le
 * préfixe NEXT_PUBLIC_ et sont figés au build de l'image.
 */

/**
 * Tant que l'alpha n'est pas ouverte, les appels à l'action n'emmènent
 * nulle part et se contentent d'un toast.
 */
export const ALPHA_OPEN = process.env.NEXT_PUBLIC_ALPHA_OPEN === "true";
