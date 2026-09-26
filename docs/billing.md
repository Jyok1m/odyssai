# Credits and subscriptions

The player buys **credits**, priced per action: a turn is worth one, a world twenty-five. The scale is in `packages/engine/src/credits.ts`, in constants that `tuning.ts` re-exports, and the ratio between a credit and its real cost is tuned there without touching Stripe.

- **Postgres is the truth of credits, not Redis.** The guide's budget lives in Redis because it is anonymous, very frequent and approximate: an eviction there costs an estimate. A credit is billed, and an eviction would erase a paid month's consumption.
- **We debit before the call and refund if it fails.** The price of an action is known in advance, unlike the guide's dollar budget: there is no reserve-then-tune dance to reproduce.
- `credit_entries` is **append-only** and freezes the balance of each entry: rereading the ledger years later must return what the player saw, even if the scale changed.
- Period rollover is **lazy, at read time**. A nightly job would do the same work less reliably and leave a player without a reserve until its pass.
- Credits **do not carry over**: the reserve is reset to the plan's allowance, never increased. Otherwise a player absent six months would come back with six months of head start.
- Moderation and embeddings are **never billed**: making the player pay for being watched would be indefensible.
- **An administrator consumes nothing.** `spend()` exits before any debit and returns `null`, like a free action: no caller tries to refund a row that does not exist. `llm_usage` keeps counting what his games cost, it is him the accounting. Counterpart to know: the exhausted-reserve screen will never display for him, checking it requires an ordinary account.
- **The earlycomers' bonus is not a tier**, it is a supplement set on the account (`FOUNDER_BONUS`). A tier is chosen, this one is ascribed; putting it in `plans` forced the pricing page to show an offer nobody could take. It is written to the ledger under its own motive, `founder`, and not melted into `welcome`: "80 credits" would not say why this player got thirty more than the next one.
- Rank is read on `created_at`, **never on a counter**: a counter desynchronizes on a deletion, a date rereads and the replayed computation returns the same answer. An administrator has no right to it and does not occupy a slot, his reserve never being debited.
- **A null allowance does not take anything back.** `roll()` only resets the reserve to zero if the tier grants something: the rule "credits do not carry over" bounds a subscriber who receives new ones, applied to an offered tier it confiscated a reserve nobody replaced. Nothing is written to the ledger when nothing moves.
- A **cancelled subscription keeps its credits**. `customer.subscription.deleted` drops the row to the free tier as `canceled` without touching the reserve, and the next rollover neither grants nor takes back. What was paid does not evaporate because the subscription stops.

## Stripe

The key and the webhook secret are the only environment variables. The tiers and their price identifiers live in the database (see the admin dashboard): in a variable, putting a tier on sale required a deployment.

- Everything is optional. Without `STRIPE_PRIVATE_KEY`, `BillingConfig.enabled` is false, selling stays silent and the free tier suffices to play: we develop without a Stripe account.
- **`ODYSSAI_ENV`, not `NODE_ENV`.** Both copies of the site run with `NODE_ENV=production`, the image being the same: it cannot tell them apart. `ODYSSAI_ENV` is `production` on the real one and `staging` on the dev one, and it alone decides the allowed Stripe mode.
- `NestFactory.create(AppModule, { rawBody: true })`, and `@Req() req: RawBodyRequest<Request>` in the controller. The signature is computed on the received bytes: the JSON re-serialized by Nest does not reproduce them. `test/billing.e2e-spec.ts` checks it end to end, that is its purpose.
- Idempotence is the **primary key of `stripe_events`**: Stripe replays until it gets a 2xx, and an `invoice.paid` processed twice would credit twice.
- **The webhook order is not guaranteed.** `invoice.paid` can precede `customer.subscription.created`: the renewal therefore rereads the subscription at Stripe before crediting, else a player who just paid would receive the free tier's allowance.
- An unknown price is ignored, never guessed: taking it for the free tier would drop a paying subscriber.
- `invoice.payment_failed` cuts nothing. Stripe retries for several days, and it is `customer.subscription.deleted` that decides.
- The guard is set **method by method** on `BillingController`: the webhook has no session.
- The portal opens **as soon as a billing space exists**, and not only on the paying tier: a player back to the free tier after a cancellation keeps his invoices and must be able to reread them. It is `manageable` that says so, distinct from `purchasable`.
- In development: `stripe listen --forward-to localhost:3001/billing/webhook` gives the secret to put in `STRIPE_WEBHOOK_SECRET`.
- **A deactivated price is refused at payment**: "The price specified is inactive". The trap comes from the idempotency key, which makes the price already created for that amount, in the state it is: the old and the new are then the same object, and "create then deactivate the old" turned against itself. `reprice` therefore reactivates a price made inactive, and only deactivates the old one if it differs from the new one.
- A tier carrying an amount without an active price is **redone on edit**, absent price like deactivated price. Comparing only amounts left it unsellable for life, and putting it back on sale required changing the price then re-listing it. The read at Stripe only costs on a tier edit. Without a configured key it is skipped: renaming a paying tier must not fail because Stripe is absent.
- Two states get edited in the dashboard and live in the database. `recommended` designates the highlighted tier, one at a time, guaranteed by a unique partial index and not by the service, where two concurrent writes would pass. It was a computation, "the middle one among the paying ones": right at three tiers, wrong at the fourth, and out of reach of whoever edits them.
- `comingSoon` announces without selling. To distinguish from a tier without a Stripe price, which is not sellable for lack of configuration: here it is a decision. An archived tier, on its side, disappears.
- `GET /billing/catalog` is **public**: the scale has nothing personal, and a pricing page must display before signup. `purchasable` is false there as long as a plan has no configured price, and the screen hides the offer instead of offering a button that would answer 503.
- A tier's name comes from the database, never from a translation key: tiers are created in the dashboard, and their names are not known at compile time.
- No euro amount in the code: prices live at Stripe, which displays them on its own page. Copying them would make two truths, and the false one would be ours.

## Tiers live in the database

`packages/engine` only carries the per-action scale, `FREE_PLAN_SLUG` and the bounds. Tiers are rows of `plans`, editable from the dashboard: changing an allowance must not require a deployment.

- The original objection (a table would make the database environment-specific) **does not hold**: both copies of the site already have their own Postgres, and a test-mode price only makes sense in the dev database. `STRIPE_PRICE_*` therefore disappeared from the configuration.
- **The seeding of the three tiers is in the migration**, not in a script: the foreign key set right after would fail on existing subscriptions, and a migration leaving the database invalid between two commands is not one.
- `subscriptions.plan` references `plans.slug` and not the uuid: it is the slug that travels in the HTTP contracts and rereads in a log. The foreign key prevents deleting a tier someone carries.
- **The free tier is protected** from archiving as from deletion: everything falls back to it, and a subscription without a tier is no longer readable.
- `PlansService` **caches nothing**: one more read per turn is negligible before the model call that follows, and a cache would keep a player on an allowance the administrator believed changed.
- **A Stripe price is immutable.** Changing an amount creates a new price and deactivates the old one; current subscribers keep theirs until their next invoice, Stripe not replaying a subscription onto a new price. It is the central trap of `AdminPlansService`.
- Writes at Stripe go **before** the database write: a product created without a row on our side shows up and gets cleaned, a row pointing to a nonexistent price would fail a payment. Creations carry an idempotency key derived from the slug.
- A price is never deleted at Stripe, only deactivated: past invoices point back to it.
- One single Stripe client, provided by `StripeModule`: three `new Stripe(...)` would end up diverging on the API version, which would show at the worst moment.

# The pricing page

`/pricing`, public, fed by `GET /billing/catalog`.

- **Nothing is hardcoded there**, neither a tier name, nor an amount, nor an allowance. The cards' bullets and the comparison lines derive from the catalogue figures, so a tier added in the dashboard slots in without touching it.
- The catalogue publishes `welcome` in addition to `monthly`: offered tiers only hold through it, and a page reading only the monthly allowance would announce zero credits on the only tier a visitor can try.
- The connected visitor's tier is **outlined** and its purchase button disappears. What one carries wins over what one recommends: putting forward an already-made purchase makes no sense.
- The button opens **Stripe**, not the account screen, through a top-level navigation: Stripe's page refuses to be loaded in the background. Without a session there is no payment to open, so the button goes through login, which brings back here.
- The account screen, on its side, only offers **a link to this page**. Stacked, the tiers compared badly there and the account became a sales page; the comparison is done in columns, here.
- The bullets say "one world, then N turns" and not "N worlds": sixty worlds is true and means nothing, nobody creates sixty.
- It enters the guide corpus, which therefore knows how to explain what a credit is. It **never announces a price**: amounts live at Stripe and allowances in the database, none of that is in the messages, and a price recited by a model would be the wrong source.
