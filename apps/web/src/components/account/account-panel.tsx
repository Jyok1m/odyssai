"use client";

import { Username, type PlayerProfile } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { ProfileError, fetchProfile, updateUsername } from "@/lib/profile";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/**
 * Le pseudo se modifie ici, l'adresse et le mot de passe non : ils
 * appartiennent au realm, et c'est sa console de compte qui les sert. L'URL
 * vient de l'API, le navigateur n'a pas a connaitre l'adresse du realm.
 */
export function AccountPanel() {
  const t = useTranslations("Account");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const { signIn } = useAuthLinks();

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Pas de garde "deja charge" : en mode strict React monte l'effet deux fois,
  // et un tel garde laisserait la premiere requete annulee sans jamais la
  // relancer. Le champ resterait desactive pour toujours.
  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();
    fetchProfile(controller.signal)
      .then((next) => {
        setProfile(next);
        setUsername(next.username ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus({ kind: "error", message: t("errorGeneric") });
      });

    return () => controller.abort();
  }, [session.status, t]);

  if (session.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  if (session.status === "anonymous") {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ui text-vellum-2">{t("signedOut")}</p>
        <Button as="a" href={signIn}>
          {tNav("login")}
        </Button>
      </div>
    );
  }

  const save = async () => {
    // Le meme schema que l'API : le champ repond sans aller-retour, et l'API
    // reste seule juge de l'unicite.
    if (!Username.safeParse(username).success) {
      setStatus({ kind: "error", message: t("errorInvalid") });
      return;
    }

    setStatus({ kind: "saving" });
    try {
      const next = await updateUsername(username);
      setProfile(next);
      setUsername(next.username ?? "");
      setStatus({ kind: "saved" });
    } catch (error: unknown) {
      const taken =
        error instanceof ProfileError && error.code === "username_taken";
      setStatus({
        kind: "error",
        message: taken ? t("errorTaken") : t("errorGeneric"),
      });
    }
  };

  const dirty = username.trim() !== (profile?.username ?? "");

  return (
    <div className="max-w-headline space-y-12">
      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("usernameLabel")}
        </h2>
        <p className="mt-2 text-ui-sm text-pretty text-vellum-2">
          {t("usernameHint")}
        </p>

        <form
          className="mt-4 flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="username" className="sr-only">
            {t("usernameLabel")}
          </label>
          <input
            id="username"
            value={username}
            maxLength={32}
            placeholder={t("usernamePlaceholder")}
            onChange={(event) => {
              setUsername(event.target.value);
              setStatus({ kind: "idle" });
            }}
            className="h-10 min-w-0 flex-1 rounded-control border border-line bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors placeholder:text-vellum-3 focus:border-accent"
          />
          <Button
            type="submit"
            disabled={
              username.trim().length === 0 || !dirty || status.kind === "saving"
            }
          >
            {t("save")}
          </Button>
        </form>

        <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm">
          {status.kind === "saved" && (
            <span className="text-accent">{t("saved")}</span>
          )}
          {status.kind === "error" && (
            <span className="text-ember">{status.message}</span>
          )}
          {status.kind === "idle" && profile?.username === null && (
            <span className="text-vellum-3">{t("usernameEmpty")}</span>
          )}
        </p>
      </section>

      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("identityTitle")}
        </h2>
        <p className="mt-2 text-ui-sm text-pretty text-vellum-2">
          {t("identityLead")}
        </p>

        <dl className="mt-6 space-y-4">
          <div>
            <dt className="text-caption text-vellum-3">{t("emailLabel")}</dt>
            <dd className="mt-1 text-ui-sm text-vellum">
              {profile?.email ?? "..."}{" "}
              {profile ? (
                <span
                  className={
                    profile.emailVerified ? "text-vellum-3" : "text-brass"
                  }
                >
                  (
                  {profile.emailVerified
                    ? t("emailVerified")
                    : t("emailUnverified")}
                  )
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-vellum-3">{t("passwordLabel")}</dt>
            <dd className="mt-1 text-ui-sm text-vellum-3">••••••••</dd>
          </div>
        </dl>

        {profile ? (
          <Button
            as="a"
            href={profile.accountUrl}
            variant="secondary"
            className="mt-6"
          >
            {t("manage")} <span aria-hidden="true">&rarr;</span>
          </Button>
        ) : null}
      </section>
    </div>
  );
}
