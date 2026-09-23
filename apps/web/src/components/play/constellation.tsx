/*
  La constellation d'un monde.

  La page du Lore promet que chaque monde a sa couleur et sa constellation :
  la couleur existait déjà, celle-ci manquait. Elle est dérivée du nom, donc
  toujours la même pour un monde donné, et elle ne dit rien de plus que « ce
  n'est pas le même » : reconnaître une carte d'un coup d'œil vaut mieux que
  lire son titre à chaque fois.

  Rien n'est enregistré : un dessin qu'on peut recalculer n'a pas à vivre en
  base, et il suivrait un nom qui changerait.
*/

// Un entier stable à partir d'un nom. FNV-1a, pour sa dispersion sur des
// chaînes courtes et parce qu'elle tient en trois lignes.
function seedOf(name: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

/*
  Un tirage linéaire congruentiel, avancé de zéro : reproductible, et
  suffisant pour placer six points. Le compteur vit dans cette fonction et non
  au fil du rendu, où il serait une variable réassignée pendant qu'on dessine.
*/
function rollAt(seed: number, steps: number): number {
  let value = seed;

  for (let step = 0; step < steps; step += 1) {
    value = (Math.imul(value, 1_103_515_245) + 12_345) >>> 0;
  }

  return value;
}

const WIDTH = 120;
const HEIGHT = 64;

export function Constellation({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const seed = seedOf(name);
  // De cinq à sept points : en deçà ce n'est qu'une ligne, au delà le tracé
  // se referme sur lui-même et deux mondes se ressemblent à nouveau.
  const count = 5 + (seed % 3);

  const points = Array.from({ length: count }, (_, index) => ({
    // Régulier en abscisse, pour que le tracé traverse toujours le cadre.
    x: 8 + (index * (WIDTH - 16)) / (count - 1),
    y: 10 + ((rollAt(seed, index + 1) >>> 8) % (HEIGHT - 20)),
  }));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      fill="none"
      className={["text-accent", className].filter(Boolean).join(" ")}
    >
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.55"
      />
      {points.map((point) => (
        <circle
          key={`${point.x}-${point.y}`}
          cx={point.x}
          cy={point.y}
          r="2.4"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
