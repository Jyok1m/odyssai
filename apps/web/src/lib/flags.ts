/**
 * Ouverture du jeu, et non de l'inscription : ouvrir un compte est déjà
 * possible, entrer en partie ne l'est pas. Aucun lecteur aujourd'hui, la route
 * de jeu n'existant pas encore, mais c'est ce drapeau qui la gardera.
 */
export const ALPHA_OPEN = process.env.NEXT_PUBLIC_ALPHA_OPEN === "true";
