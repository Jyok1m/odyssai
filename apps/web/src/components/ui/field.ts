/*
  Le style d'un champ, defini une fois.

  Le focus est porte par la bordure, jamais par un lisere : les deux ensemble
  font un double cadre. Le conteneur du champ doit donc porter
  `data-focus-ring="container"`, qui neutralise le lisere global de
  `globals.css`. Sans lui, le navigateur ajoute le sien par dessus.
*/
export const FIELD =
  "h-10 w-full rounded-control border border-line bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors focus:border-accent";

// Meme chose, sur plusieurs lignes.
export const FIELD_AREA =
  "w-full rounded-card border border-line bg-ink px-3.5 py-2.5 font-ui text-ui-sm text-vellum transition-colors focus:border-accent";

// Une saisie dont l'issue est sans retour : la bordure vire a l'ember.
export const FIELD_DANGER =
  "h-10 rounded-control border border-line bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors focus:border-ember";
