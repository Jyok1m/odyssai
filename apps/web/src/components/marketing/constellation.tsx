/**
 * Décor du hero, reprise de l'élément `.sky` du kit : les mondes sont des
 * nœuds, les arêtes les passages de l'un à l'autre, et l'étoile de laiton le
 * Lore Général (le point fixe que tous les univers partagent).
 *
 * Les quatre couleurs de monde sont les exemples d'accent du kit. Elles vivent
 * dans des attributs SVG, pas dans des classes, la convention Tailwind ne s'y
 * applique donc pas.
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

/** L'étoile à quatre branches du logo, réutilisée telle quelle. */
const LORE_STAR =
	"M0-10C1.2-2.4 2.4-1.2 10 0 2.4 1.2 1.2 2.4 0 10-1.2 2.4-2.4 1.2-10 0-2.4-1.2-1.2-2.4 0-10Z";

export function Constellation({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 600 440" aria-hidden="true" className={className}>
			<path d={EDGES} fill="none" stroke="var(--color-line)" strokeWidth="1" />
			<g fill="var(--color-vellum-3)">
				{STARS.map((s) => (
					<circle key={`${s.cx}-${s.cy}-${s.r}`} {...s} />
				))}
			</g>
			{WORLDS.map((w) => (
				<circle
					key={`${w.cx}-${w.cy}`}
					cx={w.cx}
					cy={w.cy}
					r={w.r}
					fill="var(--color-ink)"
					stroke={w.stroke}
					strokeWidth="2"
				/>
			))}
			<path
				transform="translate(300 160) scale(.7)"
				d={LORE_STAR}
				fill="var(--color-brass)"
			/>
		</svg>
	);
}
