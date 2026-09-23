import { entityKey, type Entity } from '@odyssai/schemas';

/*
  Qui et quoi se tient dans la scene.

  Derive du texte par le code, et non declare par le modele : c'est la meme
  technique que `findBorrowedNames`, des mots entiers compares sur des noms
  replies. Le lui demander aurait coute des jetons a chaque tour pour une
  reponse qu'il oublie ou arrange, comme il oublie `usedDie`.

  La contrepartie est assumee : quelqu'un qui est la sans etre nomme ne s'y
  voit pas. Une presence qu'on ne lit nulle part n'en etait pas une pour le
  joueur non plus.
*/

/*
  Les articles en tete d'un nom. Le meneur ecrit « la porte du Phare de
  Vasse » la ou la bible dit « le Phare de Vasse » : sans les retirer, un lieu
  nomme dans presque toutes ses phrases ne s'y trouve jamais.

  En tete seulement, et pour la recherche seulement : `entityKey` sert aussi
  l'unicite en base, et y replier les articles changerait des cles deja
  ecrites.
*/
const ARTICLES = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'the', 'a', 'an',
]);

function withoutArticle(key: string): string {
  const [first, ...rest] = key.split(' ');
  return rest.length > 0 && ARTICLES.has(first!) ? rest.join(' ') : key;
}

// Un nom apparait dans un texte : mots entiers, diacritiques et casse replies.
export function namedIn(text: string, name: string): boolean {
  const haystack = ` ${entityKey(text)} `;
  const key = withoutArticle(entityKey(name));
  if (key.length === 0) return false;
  if (haystack.includes(` ${key} `)) return true;

  // « Mireille » suffit pour « Mireille la Cuillere » : le premier mot d'un
  // nom compose, s'il est assez long pour ne pas etre un article.
  const first = key.split(' ')[0]!;
  return first.length >= 3 && key.includes(' ') && haystack.includes(` ${first} `);
}

/*
  Les entites que le meneur vient de nommer. L'ordre est celui ou elles
  apparaissent dans le recit : la derniere nommee est celle qui a la parole,
  et la premiere celle qui plante la scene.
*/
export function presentIn(narration: string, entities: Entity[]): Entity[] {
  const folded = entityKey(narration);

  return entities
    .filter((entity) => namedIn(narration, entity.name))
    .map((entity) => {
      // Introuvable quand seul le premier mot du nom apparait : il passe alors
      // en tete, ce qui vaut mieux qu'un rang arbitraire au milieu.
      const at = folded.indexOf(withoutArticle(entityKey(entity.name)));
      return { entity, at: at === -1 ? 0 : at };
    })
    .sort((left, right) => left.at - right.at)
    .map(({ entity }) => entity);
}
