# Moderation

Two layers, in that order, on everything a player writes.

- **Lexical first** (`packages/engine/src/moderation.ts`): instantaneous, free, it stops what is manifest before any call and before any write.
- **Classifier next** (`moderation/v6`): a small conversation model. **No dedicated moderation endpoint is reachable** with the project's keys, verified: OpenRouter answers 404 on `/moderations` and the OpenAI key is empty. An unreadable verdict or an unreachable model stand for acceptance: the lexical layer has already run, and a broken classifier must not prevent playing.
- The lexical list is **deliberately short**. Three roots were removed after taking down everyday French: `retard` (an everyday word), `fag` (caught "fagot"), `rape` (every grated cheese once accents undone). Missing them is the price; the classifier reads the sentence, not the letters.
- The comparison is **always on whole words**, never on substring, and the collapsing of repetitions only touches stretches of three letters or more: at two, `faggot` became `fagot`. A spelled-out word ("c.o.n.n.a.r.d") is only re-glued on a run of at least four isolated letters, the signature of a workaround and not of a sentence.
- The GM's answer is reread by the lexical layer alone. A second classification call would delay a narrative already gone.
- The classifier receives **the same `extraBody` as narration**, and not a variable of its own: same provider, same requirements. Without it it billed 140 to 178 reasoning tokens at the output rate to return a one-line verdict, i.e. two thirds of the cost of a moderation, and the player's message went out without `data_collection: deny`. Measured: 0.000133 $ before, 0.0000513 $ after.
