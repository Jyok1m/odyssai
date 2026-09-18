"use client";

import { Username, type PlayerProfile } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";
import { requestSignOut } from "@/lib/api";
import { MarketingOptIn } from "@/components/account/marketing-opt-in";
import { ProfileError, fetchProfile, updateUsername } from "@/lib/profile";

import { Credits } from "./credits";
import { EraseAccount } from "./erase-account";

/** `confirming` est la seconde frappe : le pseudo ne se choisit qu'une fois. */
type Step = "idle" | "editing" | "confirming" | "saving";

export function AccountPanel() {
  const t = useTranslations("Account");
  const tAuth = useTranslations("Auth");
  const tNav = useTranslations("Nav");
  const session = useSession();
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
    <div className="max-w-headline space-y-12">
      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("usernameLabel")}
        </h2>

        {chosen ? (
          <p className="mt-3 text-ui-sm text-vellum">{chosen}</p>
        ) : step === "idle" ? (
          <div className="mt-3">
            <p className="text-ui-sm text-vellum-3">{t("usernameNone")}</p>
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
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* Dit avant la saisie, pas apres : c'est la seule chose que le
                joueur doit savoir avant de taper. */}
            <p className="text-ui-sm text-brass">{t("usernameOnce")}</p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
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
                className={`min-w-0 flex-1 ${FIELD}`}
              />
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
      </section>

      <Credits />

      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("identityTitle")}
        </h2>

        <dl className="mt-4 space-y-3">
          <div>
            <dt className="text-caption text-vellum-3">{t("emailLabel")}</dt>
            <dd className="mt-1 text-ui-sm text-vellum">
              {profile?.email ?? "…"}
              {profile && !profile.emailVerified ? (
                <span className="text-brass"> ({t("emailUnverified")})</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-vellum-3">{t("passwordLabel")}</dt>
            <dd className="mt-1 text-ui-sm text-vellum-3">••••••••</dd>
          </div>
        </dl>

        {profile ? (
          <Button as="a" href={profile.accountUrl} variant="secondary" className="mt-5">
            {t("manage")} <span aria-hidden="true">&rarr;</span>
          </Button>
        ) : null}
      </section>

      {/* Avant la deconnexion : c'est un reglage du compte, pas une sortie. */}
      <MarketingOptIn profile={profile} onChange={setProfile} />

      {/* La deconnexion vit ici et plus dans le bandeau : elle n'a pas a
          occuper une place permanente a cote de la navigation. */}
      <section className="border-t border-line pt-8">
        <Button
          variant="danger"
          onClick={() => void signOut()}
          disabled={leaving}
          className="disabled:opacity-60"
        >
          {tAuth("signOut")}
        </Button>
      </section>

      {/* Tout en bas, apres la deconnexion : on ne tombe pas dessus en
          cherchant a partir pour la journee. */}
      <section className="border-t border-line pt-8">
        <EraseAccount />
      </section>
    </div>
  );
}

/** Un message par cause : « impossible d'enregistrer » ne dit pas laquelle. */
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
