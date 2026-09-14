/**
 * Drapeaux de fonctionnalité, lus côté navigateur : ils portent donc le
 * préfixe NEXT_PUBLIC_ et sont figés au build de l'image.
 */

/**
 * Ouverture du jeu, et non de l'inscription : ouvrir un compte est possible
 * dès maintenant, entrer dans une partie ne l'est pas.
 *
 * Aucun lecteur aujourd'hui, la route de jeu n'existant pas encore. Le
 * drapeau reste déclaré parce que c'est lui qui la gardera : un joueur
 * connecté voit un toast d'attente tant qu'il vaut autre chose que "true".
 */
export const ALPHA_OPEN = process.env.NEXT_PUBLIC_ALPHA_OPEN === "true";
