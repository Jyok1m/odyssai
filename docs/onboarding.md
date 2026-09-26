# Getting into the game

From the home page to the generated world. `GET/PUT /onboarding` behind `SessionGuard`, a single resource for the whole path, and the `/play` route web-side.

- **Two schemas per step** in `packages/schemas/src/onboarding.ts`: a permissive draft saved as the input goes, a strict one gating the move to the next step. The path must be resumable, so a half-filled input must be writable to the database.
- `advance: true` on an incomplete input **still saves**, then answers 422 `incomplete`: nothing the player typed is lost because he clicked too early.
- The `username` step does not exist in the database enum: it is inferred from the presence of a pseudo, and setting it goes through `PATCH /me`, not through this resource.
- The `universes` row is born at the first save, never at a read: `GET /onboarding` writes nothing. Since multiple stories, it is `StoriesService.start` that creates it when no story is open.
- One writes at one's own step or below, never beyond. `generating` and `ready` close the path; `failed` stays open, it is the only exit of a generation that did not complete.
- Themes are wiped at each change of the inspiration: they are a pure function of it, and a stale theme would have a world generated from an input the player changed.
- `characters.name` is nullable: the sheet is written several times, the presence of the name is required by the strict schema, not by the table.

## The numeric base, and talents

The attributes were a dictionary with free keys that the model filled with whatever passed in the conversation: one sheet carried "Kendo", "Tir à l'arc" and "Discrétion", the next "vigueur". Those are **skills**, not attributes, and no rule could be written on them. The schema comment already announced the move to the engine.

- **Five fixed attributes**: `corps`, `adresse`, `esprit`, `presence`, `instinct`. Without accents, because the model reads and copies them: surrounded by accented French, it would correct `presence` and the schema would reject its output.
- **One to five, and three is the middle**, hence the null modifier. Going three-to-eighteen would have broken existing sheets for nothing on a twenty-sided die. `modifierOf` returns the value minus three, from -2 to +2: two points are worth ten percent on a d20, enough for a strength to be felt without it deciding in the die's place.
- **`attributeFor` says which attribute a roll calls on**, from the situation and therefore by the code. Asking the model which one applies would amount to letting it pick the highest on the sheet. `instinct` is not listed yet, for lack of a situation calling for it: it is read and feeds the narrative, an attribute does not need to be computed to exist.
- **`bandFor` bounds the total to the faces** rather than letting it overflow, `bandOf` rejecting what is not a valid roll. Accepted consequence: a bonus can carry a nineteen up to a critical, and a malus sink a two.
- Outside a settled roll, **the modifier stays null**: the GM then judges the uncertainty himself, and mixing his freedom into the base would make the result unreadable.
- The **talents** (`characters.talents`) collect what the model used to name freely: the color, where the attributes are the calculation. The engine does not read them, the GM does.
- **An attribute rises with use, and the code decides it.** Not the GM: a player who insists would end up getting his rise, and "you feel you are progressing" costs nothing to write. Every settled roll counts for the attribute it calls on, **failures included**: missing is the most ordinary way of learning, and counting only successes would make the strongest rise and the weakest stagnate.
- `PROGRESS_STEPS` says how many rolls each tier needs, and it is increasing: three to leave one, fifteen to reach five. A real flaw gets corrected in the game where it bothers, and five is not reached by accident.
- `characters.progress` counts **since the last rise**, not since forever, and resets to zero at the tier crossed: without it one would have to replay the whole story to know where a character stands. It lives next to the sheet and not inside it, and the GM sees nothing of it.
- The rise goes out as a `grew` event, separate from `done`: it is news of its own, read once, where a turn's verdict is read with the turn.
- **The inventory is a list of names, with no effect whatsoever** (v14). An item granting a bonus would be a rule, and the effect belongs to the engine, never to the text: otherwise "I craft a sword that kills everything" would be obeyed and the game state decided in prose. The GM receives `<inventaire>`, ascribes no numeric effect to anything, and the character carries only what it contains.
- The model declares `gained` and `lost` in its tail block, `carryAfter` applies: **what it did not write there did not change hands**, whatever its narrative told. The comparison is normalized because it writes "l'épée" where it had written "épée corrompue", and what does not reappear is ignored rather than failing the turn, like the rest of `readDelta`.
- Beyond `INVENTORY_MAX`, **the item does not enter**. Dropping the oldest would lose a sword for three pebbles, and a full bag is easier to understand than a silent disappearance.
- The migration converts in this direction: the old keys become talents, the base starts at three. Without it, `CharacterSheetSchema` would reject the sheet, so `TurnMemoryService.world()` would return `null`, so **the game would become unplayable**: the strict schema is re-read at every turn.
- `AuthModule` re-exports `UsersModule` because Nest builds `SessionGuard` in the module that applies it. A game module therefore only has to import `AuthModule`.
- **The route is gated by the alpha phase**, the one of `site_settings` that the dashboard tunes, and no longer by a compile flag: opening the game is a decision taken some morning, not a deployment. Api-side, `AlphaOpenGuard` after `SessionGuard` on every game route, 403 `alpha_closed`; it is the rule. Web-side, a convenience: `GameLink` answers with a toast instead of navigating, `GameGate` displays a page saying so instead of a 404, the phase being public anyway. An administrator always passes, on both sides: that is how production gets checked before opening. `NEXT_PUBLIC_ALPHA_OPEN` no longer exists, neither in the Jenkinsfile nor in the image.
