"use client";

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import {
  ArrowLeftStartOnRectangleIcon,
  ChartBarSquareIcon,
  CreditCardIcon,
  EnvelopeIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Bars3Icon } from "@heroicons/react/20/solid";
import type { PlayerProfile } from "@odyssai/schemas";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/api";
import { fetchProfile } from "@/lib/profile";

const NAVIGATION = [
  { name: "Vue d'ensemble", href: "/admin", icon: ChartBarSquareIcon },
  { name: "Joueurs", href: "/admin/joueurs", icon: UsersIcon },
  { name: "Abonnements", href: "/admin/abonnements", icon: CreditCardIcon },
  { name: "Messages", href: "/admin/messages", icon: EnvelopeIcon },
] as const;

/**
 * La coque du tableau de bord : barre latérale, bandeau, et le garde d'entrée.
 *
 * Le garde est ici une commodité, jamais une sécurité : c'est `AdminGuard`,
 * côté API, qui refuse vraiment. Cacher l'écran à qui n'y a pas droit évite
 * seulement d'afficher une page de tableaux vides et d'erreurs 403.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();
    fetchProfile(controller.signal)
      .then(setProfile)
      .catch(() => {
        if (!controller.signal.aborted) setDenied(true);
      });

    return () => controller.abort();
  }, [session.status]);

  if (session.status === "loading") {
    return <Centered>Ouverture du tableau de bord.</Centered>;
  }

  if (session.status === "anonymous") {
    return (
      <Centered>
        <p className="text-ui-sm text-vellum-2">
          Le tableau de bord demande une session.
        </p>
        <Button
          as="a"
          href={`${API_BASE_URL}/auth/signin?redirect=/admin&locale=fr`}
          className="mt-5"
        >
          Se connecter
        </Button>
      </Centered>
    );
  }

  if (denied || (profile && !profile.isAdmin)) {
    return (
      <Centered>
        <p className="font-voice text-subtitle text-vellum">Rien à voir ici.</p>
        <p className="mt-3 max-w-prose text-ui-sm text-vellum-3">
          Ce compte n&apos;administre pas OdyssAI. Le droit se pose en base, avec
          <code className="mx-1 rounded-control bg-mist px-1.5 py-0.5 text-caption text-vellum-2">
            pnpm --filter @odyssai/api admin:grant
          </code>
          : aucune page ne l&apos;accorde.
        </p>
        <Button as={Link} href="/fr" variant="secondary" className="mt-6">
          Retour au site
        </Button>
      </Centered>
    );
  }

  if (!profile) return <Centered>Lecture du profil.</Centered>;

  return (
    <div>
      <Dialog open={open} onClose={setOpen} className="relative z-50 xl:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-ink/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />

        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <div className="absolute top-0 left-full flex w-16 justify-center pt-5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-m-2.5 p-2.5 text-vellum-2 hover:text-vellum"
              >
                <span className="sr-only">Fermer la navigation</span>
                <XMarkIcon aria-hidden="true" className="size-6" />
              </button>
            </div>

            {/* La barre mobile se referme au clic : la laisser ouverte
                cacherait la page qu'on vient d'ouvrir. Fermer depuis un effet
                sur le chemin ferait un rendu en cascade pour le meme
                resultat. */}
            <Sidebar
              profile={profile}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
            />
          </DialogPanel>
        </div>
      </Dialog>

      <div className="hidden xl:fixed xl:inset-y-0 xl:z-50 xl:flex xl:w-72 xl:flex-col">
        <Sidebar profile={profile} pathname={pathname} />
      </div>

      <div className="xl:pl-72">
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-line bg-ink/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-m-2.5 p-2.5 text-vellum-2 hover:text-vellum xl:hidden"
          >
            <span className="sr-only">Ouvrir la navigation</span>
            <Bars3Icon aria-hidden="true" className="size-5" />
          </button>

          <p className="font-voice text-ui text-vellum">
            {NAVIGATION.find((item) => item.href === pathname)?.name ??
              "Administration"}
          </p>

          <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-tag text-vellum-3">
            {profile.username ?? profile.email}
          </span>
        </div>

        <main>{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  profile,
  pathname,
  onNavigate,
}: {
  profile: PlayerProfile;
  pathname: string;
  /** Fourni par la version mobile seule : celle de bureau ne se ferme pas. */
  onNavigate?: () => void;
}) {
  return (
    <div className="flex grow flex-col gap-y-6 overflow-y-auto border-r border-line bg-abyss px-6">
      <div className="flex h-16 shrink-0 items-center gap-3">
        <Image
          src="/odyssai-mark.svg"
          alt=""
          width={28}
          height={28}
          className="size-7"
        />
        <span className="font-voice text-ui text-vellum">Administration</span>
      </div>

      <nav className="flex flex-1 flex-col">
        <ul role="list" className="-mx-2 space-y-1">
          {NAVIGATION.map((item) => {
            const current = pathname === item.href;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={[
                    "group flex gap-x-3 rounded-control p-2 font-ui text-ui-sm font-medium transition-colors",
                    current
                      ? "bg-mist text-vellum"
                      : "text-vellum-3 hover:bg-mist/60 hover:text-vellum",
                  ].join(" ")}
                >
                  <item.icon
                    aria-hidden="true"
                    className={[
                      "size-5 shrink-0",
                      current ? "text-accent" : "text-vellum-3 group-hover:text-vellum-2",
                    ].join(" ")}
                  />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto -mx-6 border-t border-line">
          <Link
            href="/fr/compte"
            onClick={onNavigate}
            className="flex items-center gap-x-3 px-6 py-4 font-ui text-ui-sm text-vellum-2 hover:bg-mist/60 hover:text-vellum"
          >
            <ArrowLeftStartOnRectangleIcon aria-hidden="true" className="size-5" />
            <span className="truncate">{profile.username ?? "Mon compte"}</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-wrap flex-col items-start justify-center px-6">
      {typeof children === "string" ? (
        <p className="text-ui-sm text-vellum-3">{children}</p>
      ) : (
        children
      )}
    </div>
  );
}
