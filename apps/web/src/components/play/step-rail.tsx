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
                  "flex size-5 items-center justify-center rounded-full border text-tag",
                  state === "done"
                    ? "border-accent bg-accent text-on-accent"
                    : state === "current"
                      ? "border-accent text-accent"
                      : "border-line text-vellum-3",
                ].join(" ")}
              >
                {state === "done" ? "✓" : position + 1}
              </span>
              {t(`steps.${step}`)}
            </span>

            {position < STEPS.length - 1 ? (
              <span aria-hidden="true" className="h-px w-6 bg-line sm:w-10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
