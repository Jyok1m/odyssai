import type { CookieOptions } from 'express';
import { AppConfig } from '../config/app-config.js';

/*
  Attributs du cookie de session, partages par l'ouverture de session et par le
  garde qui le prolonge. Deux jeux divergents produiraient deux cookies
  distincts, l'ancien survivant a cote du neuf, et l'effacement n'en emporterait
  qu'un : un navigateur ne distingue les cookies que par nom, domaine et chemin.
*/
export function sessionCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    // Pas d'attribut domain : __Host- l'interdit et borne le cookie a
    // l'origine exacte de l'API.
    sameSite: 'lax',
    path: '/',
  };
}
