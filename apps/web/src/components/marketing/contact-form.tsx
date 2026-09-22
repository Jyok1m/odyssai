"use client";

import {
  CONTACT_MESSAGE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_SUBJECT_MAX,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { FIELD, FIELD_AREA } from "@/components/ui/field";
import { sendContact } from "@/lib/contact";

/*
  Le formulaire de contact.

  Ouvert à qui n'a pas de compte : c'est souvent celui-là qui a le plus besoin
  d'écrire, et exiger une session ferait taire un visiteur qui n'arrive pas à
  s'inscrire.

  L'envoi ne dit jamais si le courriel est parti : le message est enregistré
  avant, et un serveur de messagerie en panne n'est pas l'affaire de celui qui
  écrit.
*/
export function ContactForm() {
  const t = useTranslations("Contact");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const ready = email.trim().length > 3 && subject.trim().length >= 3 && message.trim().length >= 20;

  const submit = async () => {
    setBusy(true);
    try {
      await sendContact({
        name: name.trim() || undefined,
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      setSent(true);
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-card border border-verdigris/40 bg-mist/60 p-6">
        <p className="font-voice text-subtitle text-vellum">{t("sentTitle")}</p>
        <p className="mt-3 text-ui-sm text-vellum-2">{t("sentBody")}</p>
      </div>
    );
  }

  return (
    <form
      data-focus-ring="container"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contact-name" label={t("name")} hint={t("nameHint")}>
          <input
            id="contact-name"
            type="text"
            autoComplete="name"
            maxLength={CONTACT_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </Field>

        <Field id="contact-email" label={t("email")} hint={t("emailHint")}>
          <input
            id="contact-email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
          />
        </Field>
      </div>

      <Field id="contact-subject" label={t("subject")}>
        <input
          id="contact-subject"
          type="text"
          required
          maxLength={CONTACT_SUBJECT_MAX}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className={FIELD}
        />
      </Field>

      <Field
        id="contact-message"
        label={t("message")}
        hint={t("messageHint", { max: CONTACT_MESSAGE_MAX })}
      >
        <textarea
          id="contact-message"
          required
          rows={8}
          maxLength={CONTACT_MESSAGE_MAX}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className={FIELD_AREA}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || !ready}>
          {busy ? t("sending") : t("send")}
        </Button>
        <p className="text-caption text-vellum-3">{t("privacy")}</p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-caption text-vellum-3">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-2 text-caption text-vellum-3">{hint}</p> : null}
    </div>
  );
}
