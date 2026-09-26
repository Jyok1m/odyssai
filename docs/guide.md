# Guide

Q&A agent of the showcase site, on the home page. It answers in SSE streaming from the sole texts of the content pages.

- The corpus is generated from `apps/web/messages/{fr,en}.json` into `packages/narrator/src/generated/guide-corpus.ts`, **committed**, and `corpus:check` fails if it drifted. Any change to a content page therefore requires a `corpus:build`.
- Five layers bound the cost: validated FAQ (free, served without pass nor limit), Turnstile pass in a cookie, hourly and daily windows by hashed IP, concurrency semaphore, reserved then tuned daily budget. Everything goes through Lua scripts on the existing Redis.
- The off-topic question is flagged by the model with the `[[HORS_SUJET]]` sentinel, intercepted before the first byte served; the text rendered to the visitor is written server-side.
- **The prompt is at v2.** The v1 claimed the game was not playable, which stopped being true, and forbade any price, which was fair as long as no amount reached the model. The v2 talks about a closed alpha and pre-registration, and allows quoting a price, but **only from the `<tarifs>` block**, never otherwise and never if it is absent.
- **Amounts do not enter the corpus, they arrive alongside.** The corpus is generated from the site messages, where no price appears: the tiers live in the database and the amounts at Stripe, copying them into a translation file would make two truths. `GuidePricingService` therefore reads the tiers at every question and passes them as `live`, after the corpus and before the question, which only breaks the prompt cache on the day a price changes.
- This service **caches nothing** and **never fails**: an unavailable database returns an empty string, the block disappears, and the guide points to the pricing page instead of inventing.
- The budget is estimated on the prompt **tarifs included**: counting them afterwards would under-estimate the reservation, and it is the budget that keeps the spend.
- The About page enters the corpus. "Who is behind this site" gets asked before entrusting an address to an alpha game, and the answer must not be hard to find.
