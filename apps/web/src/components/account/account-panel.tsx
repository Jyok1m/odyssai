"use client";

import { Username, type PlayerProfile } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Definition, Panel, Tag } from "@/components/ui/panel";
import { FIELD } from "@/components/ui/field";
import { requestSignOut } from "@/lib/api";
import { MarketingOptIn } from "@/components/account/marketing-opt-in";
import { ProfileError, fetchProfile, updateUsername } from "@/lib/profile";

import { Credits } from "./credits";
import { EraseAccount } from "./erase-account";
import { StoriesStanding } from "./stories-standing";

// `confirming` est la seconde frappe : le pseudo ne se choisit qu'une fois.
type Step = "idle" | "editing" | "confirming" | "saving";

export function AccountPanel() {
  const t = useTranslations("Account");
  const tAuth = useTranslations("Auth");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const format = useFormatter();
  const { signIn } = useAuthLinks();

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [username, setUsername] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Pas de garde "deja charge" : en mode strict React monte l'effet deux fois,
  // et un tel garde laisserait la premiere requete annulee sans la relancer.
  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();
    fetchProfile(controller.signal)
      .then(setProfile)
      .catch(() => {
        if (!controller.signal.aborted) setError(t("errorGeneric"));
      });

    return () => controller.abort();
  }, [session.status, t]);

  if (session.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  if (session.status === "anonymous") {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ui-sm text-vellum-2">{t("signedOut")}</p>
        <Button as="a" href={signIn}>
          {tNav("login")}
        </Button>
      </div>
    );
  }

  const submit = async () => {
    if (!Username.safeParse(username).success) {
      setError(t("errorInvalid"));
      return;
    }

    // Premiere frappe : on demande confirmation au lieu d'enregistrer.
    if (step === "editing") {
      setError(null);
      setStep("confirming");
      return;
    }

    setStep("saving");
    try {
      setProfile(await updateUsername(username));
      setStep("idle");
      setError(null);
      toast.success(t("saved"));
    } catch (caught: unknown) {
      const code = caught instanceof ProfileError ? caught.code : "unknown";
      setError(t(profileErrorKey(code)));
      if (code === "unknown") console.error("pseudo non enregistré", caught);
      setStep("editing");
    }
  };

  const signOut = async () => {
    setLeaving(true);
    try {
      // Et non router.push : la fin de session est une page de Keycloak.
      window.location.assign(await requestSignOut());
    } catch (caught: unknown) {
      console.error("déconnexion impossible", caught);
      toast.error(tAuth("signOutFailed"));
      setLeaving(false);
    }
  };

  const chosen = profile?.username ?? null;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Le pseudo : la seule pièce de l'identité que l'application décide,
            et elle ne se choisit qu'une fois. */}
        <Panel title={t("usernameLabel")}>
          {chosen ? (
            <>
              <div className="flex items-center gap-5">
                <span
                  aria-hidden="true"
                  style={{ borderRadius: "var(--radius-portal)" }}
                  className="grid h-28 w-20 flex-none place-items-center border border-accent/40 bg-mist pt-4 font-voice text-title text-accent sm:h-36 sm:w-28 sm:pt-6 sm:text-display-compact"
                >
                  {chosen.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="font-voice text-title text-pretty text-vellum">
                    {chosen}
                  </p>
                  <p className="mt-2 text-ui-sm text-pretty text-vellum-2">
                    {t("usernameSeen")}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Tag tone="brass">{t("usernameSettled")}</Tag>
                {profile ? (
                  <span className="text-caption text-vellum-3">
                    {t("memberSince", {
                      date: format.dateTime(new Date(profile.createdAt), {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }),
                    })}
                  </span>
                ) : null}
              </div>
            </>
          ) : step === "idle" ? (
            <div>
              <p className="max-w-measure text-ui-sm text-pretty text-vellum-3">
                {t("usernameNone")}
              </p>
              <Button
                variant="secondary"
                className="mt-4"
                disabled={profile === null}
                onClick={() => setStep("editing")}
              >
                {t("choose")}
              </Button>
            </div>
          ) : (
            <form
              data-focus-ring="container"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {/* Dit avant la saisie, pas après : c'est la seule chose que le
                  joueur doit savoir avant de taper. */}
              <p className="text-ui-sm text-brass">{t("usernameOnce")}</p>

              <label htmlFor="username" className="sr-only">
                {t("usernameLabel")}
              </label>
              <input
                id="username"
                autoFocus
                value={username}
                maxLength={32}
                onChange={(event) => {
                  setUsername(event.target.value);
                  // Toute frappe annule la confirmation en cours.
                  if (step === "confirming") setStep("editing");
                  setError(null);
                }}
                className={`mt-4 ${FIELD}`}
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  disabled={username.trim().length === 0 || step === "saving"}
                >
                  {step === "confirming"
                    ? t("confirm", { name: username.trim() })
                    : t("save")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setStep("idle");
                    setUsername("");
                    setError(null);
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </form>
          )}

          <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
            {error}
          </p>
        </Panel>

        <Credits />
        <StoriesStanding />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* L'identité appartient au service qui l'authentifie. Le profil de
            jeu reste ici, et ne remonte jamais là-bas. */}
        <Panel title={t("identityTitle")} aside={t("identityHeld")}>
          <dl className="divide-y divide-line">
            <Definition term={t("emailLabel")}>
              {profile?.email ?? "\u2026"}
              {profile && !profile.emailVerified ? (
                <span className="text-brass"> ({t("emailUnverified")})</span>
              ) : null}
            </Definition>
            <Definition term={t("passwordLabel")}>
              <span className="text-vellum-3">{"\u2022".repeat(8)}</span>
            </Definition>
          </dl>

          <p className="mt-5 max-w-measure text-ui-sm text-pretty text-vellum-2">
            {t("identityLead")}
          </p>

          {profile ? (
            <Button as="a" href={profile.accountUrl} variant="secondary" className="mt-5">
              {t("manage")} <span aria-hidden="true">&#8599;</span>
            </Button>
          ) : null}
        </Panel>

        <MarketingOptIn profile={profile} onChange={setProfile} />
        <EraseAccount />
      </div>

      {/* La déconnexion vit ici et plus dans le bandeau : elle n'a pas à
          occuper une place permanente à côté de la navigation. */}
      <Panel>
        <Button
          variant="danger"
          onClick={() => void signOut()}
          disabled={leaving}
          className="disabled:opacity-60"
        >
          {tAuth("signOut")}
        </Button>
      </Panel>
    </div>
  );
}

// Un message par cause : « impossible d'enregistrer » ne dit pas laquelle.
function profileErrorKey(code: ProfileError["code"]) {
  switch (code) {
    case "username_taken":
      return "errorTaken" as const;
    case "username_locked":
      return "errorLocked" as const;
    case "unreachable":
      return "errorUnreachable" as const;
    case "unauthenticated":
      return "errorSignedOut" as const;
    default:
      return "errorGeneric" as const;
  }
}
