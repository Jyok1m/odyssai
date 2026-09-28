# Admin dashboard

`/admin`, **outside the `[locale]` segment and outside the next-intl proxy**, in French only: a back-office only the administrator sees has no English-speaking audience, and translating it would have doubled every label for nobody. `admin` is therefore excluded from the `matcher` of `src/proxy.ts`, else `/admin` would be redirected to `/fr/admin`, where nothing answers.

- A reserve adjustment goes through the ledger, with a **mandatory reason**: it is append-only, and a balance reset to zero must read there as a dated movement, not as a hole. The balance never goes below zero.
- The player list paginates **by cursor**: it grows while one reads it, and an offset by page number would skip or repeat rows. The `id` being a uuid v7, descending order suffices.
- Cancelling a subscription does **not** write the return to the free tier: it will come from the `customer.subscription.deleted` webhook, the sole source of the right. Writing it at once would make our rows diverge from Stripe's if the call failed midway.
- The visual primitives live in `components/admin/ui.tsx` and not in `components/ui`: the kit dresses the game, they dress a back-office. The tokens, on their side, are well those of the kit.
- The figures are **separate cards**, not a block segmented by rules. The previous pattern glued four values into a single frame: readable, but nothing stood out there and nothing was clickable. Separated, they carry a tinted icon and a link to the screen one would open anyway after reading them.
- A card reacts to hover **only if it leads somewhere**: a figure that animates without doing anything reads as a broken button. The two pure measures (credits in circulation, model cost) therefore have no link.
- The navigation badge only displays from one on: a permanent zero stops being looked at after a day.
- **Deleting a player goes through `ErasureService`**, the same rule as the voluntary departure (`docs/stories-and-erasure.md`): Stripe cancelled first, worlds released or kept by the encounters rule, the `users` row last. A second erasure path would have diverged from the first the day one of them changed. What it does not do: the identity, which belongs to the realm and over which the api has no rights. A deleted player who signs in again gets an empty account, exactly as after his own departure, and his live session re-creates that empty row on its next request.
- **An administrator does not erase himself from here.** `is_admin` is set by no route (`admin:grant`, hence server access), so a dashboard that could erase its last administrator would close its own door. `DELETE /me` remains, where the question is asked of the right person. The refusal is server-side, `cannot_delete_self` : hiding the button is only a convenience.
- The action lives in the player's drawer and not in a column of the list: a click away in a dense table, an action without return is taken by mistake. It is behind the same typed word as the rest.
- `components/admin/confirm.tsx` duplicates `ui/danger-action` because the latter takes its texts from next-intl, which `/admin` does not have. The same word to type on both sides, so as not to have two reflexes to learn.

## Consent to newsletters

A checkbox on the account screen, `users.marketing_opt_in`, and the extraction of addresses in the dashboard.

- **Unchecked by default, and nobody toggles it in the player's place**: a pre-checked box is not a consent.
- Two columns and not one. `marketing_opt_in_at` carries the instant of the last change, **in both directions**: a consent is proven, and a withdrawal must be shown as well as an agreement.
- The file is built in the browser from the JSON response. An API endpoint returning a file would require a top-level navigation, hence taking the session cookie out of its `credentials: include`.
- The list marks those who said yes, never those who said no: a refusal does not have to signal itself.
- `PATCH /me` accepts both fields independently, and refuses an empty body: the pseudo is set once, the consent is withdrawn as many times as one wants.
