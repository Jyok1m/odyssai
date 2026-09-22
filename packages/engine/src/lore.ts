import {
  entityKey,
  type Entity,
  type WorldBible,
} from '@odyssai/schemas';

/*
  Les entites que la generation seme. La bible est ecrite une fois ; ce qui
  vit ensuite, c'est ce que le meneur pose en jeu, et il faut que les
  personnages du premier jour soient la des le debut, avec leur secret.
*/
export function seedEntities(bible: WorldBible): Entity[] {
  const npcs: Entity[] = bible.npcs.map((npc) => ({
    name: npc.name,
    kind: 'npc',
    known: `${npc.role}. ${npc.drive}`,
    hidden: npc.secret,
  }));

  const factions: Entity[] = bible.factions.map((faction) => ({
    name: faction.name,
    kind: 'faction',
    known: `${faction.creed} ${faction.territory}`,
    hidden: null,
  }));

  // Une bible peut nommer deux fois la meme chose : la premiere l'emporte.
  const seen = new Set<string>();
  return [...npcs, ...factions].filter((entity) => {
    const key = entityKey(entity.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/*
  Le cache sort : il rejoint ce que le joueur sait, et il n'y a plus rien a
  garder. Une revelation ne se defait pas.
*/
export function revealLore(entity: Entity): Entity {
  if (!entity.hidden) return entity;
  return {
    ...entity,
    known: `${entity.known} ${entity.hidden}`,
    hidden: null,
  };
}
