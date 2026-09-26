import { useTranslations } from "next-intl";
import type { OnboardingStep } from "@odyssai/schemas";

// Les trois étapes que le joueur remplit. La génération n'en est pas une.
const STEPS = ["username", "inspiration", "character"] as const;

export function StepRail({ current }: { current: OnboardingStep }) {
  const t = useTranslations("Play");
  const index = (STEPS as readonly string[]).indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {STEPS.map((step, position) => {
        const state =
          index === -1 || position < index
            ? "done"
            : position === index
              ? "current"
              : "todo";

        return (
          <li key={step} className="flex items-center gap-3">
            <span
              className={[
                "flex items-center gap-2 text-caption",
                state === "current" ? "text-vellum" : "text-vellum-3",
              ].join(" ")}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className={[
                  "relative flex size-5 items-center justify-center rounded-full border text-tag transition-colors duration-base",
                  state === "done"
                    ? "border-accent bg-accent text-on-accent"
                    : state === "current"
                      ? "border-accent text-accent"
                      : "border-line text-vellum-3",
                ].join(" ")}
              >
                {state === "current" ? <Halo /> : null}
                {/* La clé suit l'état : la coche éclot quand l'étape passe. */}
                <span key={state} className={state === "done" ? "animate-pop" : undefined}>
                  {state === "done" ? "✓" : position + 1}
                </span>
              </span>
              {t(`steps.${step}`)}
            </span>

            {position < STEPS.length - 1 ? (
              <Connector filled={state === "done"} className="w-6 sm:w-10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/*
  Le trait entre deux pastilles. Le remplissage se déroule par `scale` depuis
  la gauche, sur le trait de fond : il ne réagence rien.
*/
export function Connector({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`relative h-px overflow-hidden bg-line ${className}`}>
      <span
        className={[
          "absolute inset-0 origin-left bg-accent transition-transform duration-slow ease-emerge",
          filled ? "scale-x-100" : "scale-x-0",
        ].join(" ")}
      />
    </span>
  );
}

// L'onde autour de la pastille en cours. Coupée quand le mouvement est réduit.
export function Halo() {
  return (
    <span
      aria-hidden="true"
      className="absolute -inset-px animate-halo rounded-full border border-accent"
    />
  );
}
