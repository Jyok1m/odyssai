import type { UiLocale } from '@odyssai/schemas';

/**
 * Textes fixes, ecrits cote serveur et jamais generes. Le modele ne fait que
 * signaler le cas par sa sentinelle : ce que lit le visiteur est ecrit ici.
 */
export const GUIDE_OFF_TOPIC_REPLY: Record<UiLocale, string> = {
  fr: "Je suis le guide d'OdyssAI : je réponds uniquement aux questions sur le jeu, son concept, ses univers, le multivers et le Lore. Pose-moi une question là-dessus !",
  en: 'I am the OdyssAI guide: I only answer questions about the game, its concept, its universes, the multiverse and the Lore. Ask me something about that!',
};

/** Servi quand le budget du jour est epuise ou le guide desactive. */
export const GUIDE_DEGRADED_REPLY: Record<UiLocale, string> = {
  fr: "Le guide a atteint sa limite pour aujourd'hui. En attendant, tu trouveras l'essentiel dans les pages Concept, Univers et Lore.",
  en: 'The guide has reached its limit for today. In the meantime, you will find the essentials on the Concept, Universes and Lore pages.',
};
