# Contact and outgoing mail

`/contact`, open without a session: it is often the one without an account who most needs to write, and requiring a session would silence a visitor who cannot sign up.

- **The message is written to the database before sending**, never the reverse: a mail server refusing must not lose what someone took the time to write. `delivered` says whether the email went out, and the dashboard shows the message in every case, `/admin/messages`.
- The form never says whether the email went out. It is not the writer's business, and the message is saved anyway.
- `MailConfig` is **entirely optional**, like Stripe: without configuration, `enabled` is false and only the sending stays silent. We develop without a mail server.
- The account depends on the site copy, `no-reply-dev@` on the development one and `no-reply@` in production: both images being identical, it is the environment that tells them apart. The server is the mailcow already carrying the domain's MX, on **587 with STARTTLS required** (`requireTLS`), else nodemailer would continue in clear if the server did not announce it.
- `pnpm --filter @odyssai/api mail:smoke` sends one real control message, like `llm:smoke`.
- **An environment value containing a space gets quoted.** `SMTP_FROM_NAME="Message @ Odyssai"`: without the quotes, any `set -a && . ./.env` breaks on the `@`, which the Makefile already documents for `.env.local`.
