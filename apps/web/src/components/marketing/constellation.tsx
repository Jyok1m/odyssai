/*
  Décor du hero, reprise de `.sky` du kit : les mondes sont des nœuds, les
  arêtes les passages, l'étoile de laiton le Lore Général.

  Les quatre couleurs sont les accents du kit, dans des attributs SVG et non
  des classes : la convention Tailwind ne s'y applique pas.
*/
const EDGES =
  "M70 110L200 60L300 160L430 90L540 190L500 340L380 270L300 160M380 270L230 320L130 230L70 110M130 230L300 160";

const STARS = [
  { cx: 70, cy: 110, r: 2.5 },
  { cx: 200, cy: 60, r: 2.5 },
  { cx: 430, cy: 90, r: 2.5 },
  { cx: 230, cy: 320, r: 2.5 },
  { cx: 130, cy: 230, r: 2.5 },
  { cx: 500, cy: 340, r: 2.5 },
  { cx: 40, cy: 300, r: 1.2 },
  { cx: 330, cy: 40, r: 1.2 },
  { cx: 570, cy: 60, r: 1.2 },
  { cx: 450, cy: 400, r: 1.2 },
  { cx: 170, cy: 400, r: 1.2 },
  { cx: 260, cy: 230, r: 1.2 },
  { cx: 470, cy: 240, r: 1.2 },
];

const WORLDS = [
  { cx: 300, cy: 160, r: 8, stroke: "var(--accent)" },
  { cx: 380, cy: 270, r: 7, stroke: "#7FA7FF" },
  { cx: 540, cy: 190, r: 7, stroke: "#EC7DB8" },
  { cx: 130, cy: 230, r: 6, stroke: "#B7C46A" },
];

// L'étoile à quatre branches du logo, réutilisée telle quelle.
const LORE_STAR =
  "M0-10C1.2-2.4 2.4-1.2 10 0 2.4 1.2 1.2 2.4 0 10-1.2 2.4-2.4 1.2-10 0-2.4-1.2-1.2-2.4 0-10Z";

/*
  `animated` : le décor se dessine à l'arrivée. Les arêtes se tracent, les
  étoiles s'allument, les mondes éclosent, puis l'étoile du Lore. Les
  retards sont des rangs de cadence, nuls quand le mouvement est réduit, et le
  tracé est coupé net dans ce cas.
*/
export function Constellation({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  // Le centre de chaque forme, et non l'origine du SVG : sans quoi un monde
  // grandirait depuis le coin haut gauche du dessin.
  const bloom = animated ? "transform-fill origin-center animate-pop" : undefined;

  return (
    <svg viewBox="0 0 600 440" aria-hidden="true" className={className}>
      <path
        d={EDGES}
        fill="none"
        stroke="var(--color-line)"
        strokeWidth="1"
        {...(animated
          ? { pathLength: 1, strokeDasharray: 1, className: "animate-draw" }
          : {})}
      />
      <g fill="var(--color-vellum-3)">
        {STARS.map((s, index) => (
          <circle
            key={`${s.cx}-${s.cy}-${s.r}`}
            {...s}
            className={animated ? `animate-fade ${STAR_DELAYS[index % STAR_DELAYS.length]}` : undefined}
          />
        ))}
      </g>
      {WORLDS.map((w, index) => (
        <circle
          key={`${w.cx}-${w.cy}`}
          cx={w.cx}
          cy={w.cy}
          r={w.r}
          fill="var(--color-ink)"
          stroke={w.stroke}
          strokeWidth="2"
          className={animated ? `${bloom} ${WORLD_DELAYS[index]}` : undefined}
        />
      ))}
      <g className={animated ? `${bloom} motion-delay-9` : undefined}>
        <path
          transform="translate(300 160) scale(.7)"
          d={LORE_STAR}
          fill="var(--color-brass)"
        />
      </g>
    </svg>
  );
}

/*
  Écrits en entier pour que Tailwind les trouve : une classe composée à
  l'exécution n'est jamais générée.
*/
const STAR_DELAYS = ["motion-delay-1", "motion-delay-3", "motion-delay-2", "motion-delay-4"];
const WORLD_DELAYS = ["motion-delay-5", "motion-delay-6", "motion-delay-7", "motion-delay-8"];
