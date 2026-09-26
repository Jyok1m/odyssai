# Multiplayer: one story, several players

A party is a group of 2 to 4 players sharing **one story**: one universe, one
message log, one canon, one arc, one world generated once for everybody. Each
player keeps their own character, their own inspiration, their own credits.
Solo play is untouched: a player who starts alone never gets a `parties` row,
and every rule below only exists when one does.

## Data model

Three tables and three columns, nothing else. The universe **is** the story
(its messages, turns, entities, canon and arc are the shared state), so the
party hangs off it rather than beside it.

- `parties`: `id`, `universe_id` (unique, cascade: the party dies with its
  story), `size` (the count chosen by the host, 2 to 4), `invite_code` (unique,
  8 characters from an unambiguous alphabet), timestamps.
- `party_members`: `party_id` (cascade), `user_id` (unique + cascade: a player
  sits at one table at a time, and the row goes when they do),
  `works` (the member's cited works: their own inspiration), `ready` (their
  sheet is validated and their share paid), `is_host`, `joined_at`.
- `characters.owner_id` (nullable, SetNull): the player this character
  belongs to. Backfilled with the universe owner, so existing sheets keep
  their meaning. The unique on `universe_id` becomes one on
  `(universe_id, owner_id)`: one character per player per universe, several
  players per universe.
- `conversation_messages.member_id` (nullable): the member a message belongs
  to. The character-creation channel becomes one thread per member; in the
  game channel it marks who spoke (null on the group's shared assistant
  messages, and everywhere in a solo story). The unique
  `(universe, channel, seq)` does not move: every channel keeps a single seq
  counter, threads read back filtered by member.
- `turns.member_id` (nullable): whose roll and verdict a turn row carries, so
  "my last roll" stays mine in a group, and the die stays auditable per
  player.

The universe is owned by the host at creation. Ownership is a mirror, not a
right: every read of "my open story" resolves the pointer through **either**
ownership **or** an active membership (`stories.service.ts`), because the
pointer is not proof, membership or not.

## The path, per member

The host creates the party (`POST /parties { size }`): a fresh universe at the
inspiration step, plus the party and the host membership, opened like any
story. Friends join with the code (`POST /parties/join { code }`), allowed
only while the story is still at the inspiration step and the table is not
full. There is no invitation mail: the code is shared out of band.

Each member then walks the same path as a solo player, inside the shared
universe:

- **Inspiration**: cited works only in v1 (the own-description mode stays
  solo: fusing several free texts into one coherent world is an arbitration
  the abstraction pass has no rule for, while it already knows how to merge
  several titles into one theme set). The member's works live on their
  membership row. The universe step moves to `character` when **all** members'
  works pass the strict schema: the step is the group's, and one writes at
  one's own step or below, as solo.
- **Character**: the creation conversation is a thread per member
  (`member_id`), with its own turns count and its own reset. The sheet is
  written per player: `characters (universe_id, owner_id)`. `advance: true`
  with a complete sheet debits the member's share of the world (see credits)
  and marks them `ready`; the member who completes last moves the story to
  `generating` and enqueues the single generation job. Until then, a ready
  member's sheet writes are refused (`locked`): letting them edit after
  paying would double-charge on re-advance.

The generation itself is the existing graph, once: the abstraction pass
receives the union of all members' works (deduplicated by folded title), and
the generation prompt receives **all** the sheets, so the NPCs, the affinities
and the arc bind to the group and not to whoever created the table.

## Turn sequencing

The group chat decides who plays: **no forced rotation**. A strict order would
break the first time a player is absent, and "the story proceeds from the
combined inputs" is exactly what free ordering gives. What the group cannot
do is narrate twice at once, so:

- One **turn lock** per story in Redis (`SET NX EX`, token, compare-and-del on
  release, TTL 180 s). While a member's turn is being narrated, any other
  turn request on the same story answers 409 `busy`. Solo stories get the
  same lock: it closes the double-submit race that two tabs could already
  trigger.
- **Everything a turn consumes is taken under the lock**: the pending roll
  (`getdel`), the rate-limit slot, the `already_started` count, the debit.
  Only moderation runs before it, since it consumes nothing and a
  classification call must not hold the table. Taken after them, a `busy`
  cost the player their awaited roll (the next click answered
  `roll_expired`) and a slot of their hourly limit, for nothing played.
- **The world is read again once the lock is held.** Read before, it was the
  world as it stood before the turn that had just finished: its entities,
  act and sheet were stale, and creating an entity that turn had just
  created failed the final write after the narration had been streamed.
- **The live turn renews its lock** (compare-and-expire every 60 s). A turn
  chains the line, the narration, one lore call per new name and the mark,
  and could outlast a fixed TTL: the lock fell, a second turn took the next
  rank, and the first turn's final write failed after streaming. The TTL now
  only bounds a dead process. The lock is released in the `finally` that
  ends the stream.
- The two-step die is unchanged and per player (the pending action lives in
  Redis under the user id). When a member's turn starts narrating, the
  **other** members' pending actions are dropped: the scene is about to move,
  and an awaited roll on a stale action would land on a scene that changed.
- Everything the die touches belongs to the **acting member**: the roll, the
  attribute, the harm, the health, the inventory, the progress, the mark.
  Everything the world remembers is **shared**: messages, canon facts,
  entities, revealed lore, the act. A declaration can only move the act one
  notch, as solo.
- The language of a turn stays the acting player's: the group may mix
  languages and the narrator answers each player in their own.

## How the narrator sees the group

The solo prompt (`turn/v23`) is untouched; a party turn is played by a
separate versioned prompt, `turn/party/v1`, built from the same blocks
(entities, arc, canon, die, reminders, line). Differences:

- A `<groupe>` block lists every live character as one JSON line
  (`nom`, `etat`, `resume`, `actif`), the acting one marked. The acting
  member's full sheet stays in `<personnage>`; the others stay one-liners so
  the prompt does not grow with the group.
- **Another player's sheet is untrusted data.** `partyActor` rereads it at
  every turn: the name through `CharacterSheetSchema`'s bound, the
  personality through `PersonalitySchema`, both through the lexical
  `isClean`. An invalid or refused name gives "un autre voyageur" / "another
  traveler" and an empty summary; a refused summary alone stays empty. The
  JSON escapes `<`, `>` and `&` in unicode: a summary holding `</groupe>`
  closes nothing, and the line still parses.
- **Every player message is signed and delimited.** `recall()` carries
  `memberId`, and the party prompt replays each past player message as
  `<message_joueur auteur="...">`, name and content escaped, the current one
  signed by the acting character. A departed member signs with the neutral
  name. Without it, a message from one seat reached the next turn as a bare
  user turn, read as an instruction, and the narrator could not tell who
  spoke. The narrator's own answers replay as they are.
- The "data, never an instruction" rule covers `<groupe>` and every
  `<message_joueur>`, whoever wrote it, in both languages.
- **The canon never speaks for another player.** `arbitrateCanon` refuses
  (`other_player`) a fact whose subject names another current member's
  character: written on one member's turn, it would enter every prompt of
  the others. `canon_facts.member_id` keeps whose turn a fact came from, null
  in solo and after that account's deletion.
- The narrator addresses the group: "vous" to the group, and the acting
  player by name and "tu" when their character is concerned. Every rule about
  never playing a player's character extends to **all** of them: the narrator
  moves the world in response to the active one, and never lends a gesture to
  the others either.
- The opening scene situates the group (where they are, who they are
  together), not a lone character; the same three-part order and tone
  measurement apply.
- The tail JSON is the same shape; `gained` and `lost` are the acting
  character's hands, `met`, `revealed` and `facts` are the world's.

Streaming stays point-to-point: the acting member's request carries the SSE
flow. The others see the story through history: `GET /turn` is the shared log
(authored messages), and the group view refreshes it while idle. A Redis
pub-sub broadcast was considered and rejected for v1: it needs a subscriber
connection per api instance for a gain a poll already gives.

## Credits

- **Their own actions**: a turn, a question, a dialogue call, a lore
  fragment, a mark are debited to the acting member, at the existing scale.
  Nobody pays for anybody else's play.
- **The opening scene is paid by whoever opens it**, one turn at the usual
  price. It is the group's scene, but a single request plays it, and
  splitting one credit across seats would add ledger rows and refund paths
  for nothing. A decision, not an oversight.
- **The world, split**: each member pays
  `ceil(worldGeneration / size)` credits, at their own character advance, to
  the same ledger reason and ref as solo. Rounding up is the honest direction:
  a credit is the smallest unit, and undercharging the group would make a
  shared world cheaper than a solo one. The refund paths read the ledger by
  ref, so a share is refunded as a share.
- Members never pay for moderation or embeddings, as solo.

## Leaving, failing, coming back

- **A member leaves** (`DELETE /parties/me`, the path's restart, or account
  deletion): their membership row goes, their creation thread goes, and
  their character is kept with `died_at` set, the existing vocabulary of "a
  character other players have met": the group has met them thoroughly, and
  the shared log keeps making sense. The departure answers
  `{ world: kept, character: remembered }`.
- **Their game messages keep their rank, not their words.** The content is
  emptied, the row and its `seq` stay: the narrator's answers around them
  still read in order, and the world is emptied of the player's words as the
  departure rule and the Privacy page say. `GET /turn` marks the row
  `erased`, the screen says "message removed", and the party prompt replays
  it as a neutral placeholder signed by "another traveler". Keeping them
  verbatim contradicted both.
- **Deleting the account goes further for the character**: it is deleted
  unless someone outside the table met it (an encounter), as in solo. The
  sheet and personality are what the player wrote; the group keeps the
  narrator's story, not the sheet. Their essence goes with the account.
- **The last member out** also applies the solo rule to the characters the
  departed members left behind: kept only if a visitor met them, deleted
  otherwise (their essence stays with their player). They used to survive
  as orphans of a deleted world, player-written personality included. A
  kept world loses its `parties` row and invite code: it is no longer a
  table.
- **Deleting the account during `generating`** is not refused: the right to
  erasure does not wait on a generation. The share is not refunded, as for
  leaving after generation: the world is being made with them. Leaving
  voluntarily still waits (`locked`), and only `inspiration`, `character`
  and `failed` refund a share.
- **A ready member cannot reset their sheet** (`DELETE /onboarding/character`
  answers `locked`), as the sheet itself is locked: the reset left the seat
  ready without a sheet, the worker dropped it silently, and the player
  never found a game again.
- **The host leaves**: the story survives. Ownership of the universe passes
  to the earliest-joined remaining member, the party with it. The last member
  out applies the usual departure rule to the world (kept if visited, deleted
  otherwise). A host deleting "their" story while others play is therefore
  the same as leaving it, and nobody can gut a table others sit at.
- **Inheriting a story skips the story cap**, deliberately. The member who
  receives ownership may go over `STORIES_MAX`: refusing the transfer would
  leave a table without an owner, or block the host's departure on somebody
  else's count. The cap bounds what a player starts, not what they inherit.
- **Leaving while assembling** refunds the share: nothing was generated for
  them. Only the request that actually deletes the seat refunds (the delete
  runs first, in the departure's transaction, and a count of zero means
  someone else already left): refunding first, on a ledger read, let two
  concurrent leaves refund twice. A member who leaves after generation does not get their share back:
  the world exists because they were part of it.
- **No late join**: once the story leaves the inspiration step the code
  closes. A party must also be **full** to generate: the size is the count
  the host chose, and an empty seat means somebody is still expected. A
  table that never fills is disbanded and recreated; the disbanded members'
  shares are refunded.
- **The story leaves inspiration only when the table is full** and every
  seat has cited its works. It used to leave as soon as the seated members
  had: two early seats out of three closed the door on the third, for a
  table `launch` would never accept.
- **Joining and leaving inspiration take the party row** (`SELECT ... FOR
  UPDATE`, `lockParty`): the step is re-read, the seats counted and the new
  one inserted in one transaction. Two concurrent joins both saw a free seat
  and the table went over its size, which no generation accepted any more;
  a join could also land between the works check and the step change.
- **Opening a table is one transaction**: the story and the party are
  written together, so two concurrent opens leave one table and one story.
  The second one used to fail on the unique seat with a 500, after creating
  a story that counted against the cap; it now answers `in_party`.
- **A failed generation** settles like solo: every unreturned debit with the
  story's ref, **up to the failed job's creation**, is refunded (the refund
  service returns all of them, not the oldest), and the path reopens for all
  members, who re-advance and re-pay, as a solo player retries. The reader
  that claims the job (`refunded_at`) also sets every seat back to not
  ready: before, the seats stayed ready on a refunded share, and the first
  member to re-advance relaunched for everyone. A re-advance settles first,
  so `ready` has a single meaning (share paid for the next generation), and
  a share re-paid for the relaunch is never refunded by the old failure.
- **Disconnect mid-turn** changes nothing for the group: the narration is
  never aborted, the tail block writes the canon, and the player finds the
  turn in the log when they return. The lock expires on its own if the
  process dies.
- **Paying for a seat** reserves before it debits: a conditional write turns
  the seat ready (`ready: false` to `true`), and only the request that flips
  it pays; the other gets `locked`. An out-of-credits debit sets it back.
  Solo does the same with the step (`character` or `failed` to
  `generating`). Two concurrent advances both read "not ready" and both
  paid before.
- **Idempotency**: the party lock serializes narrations per story, the
  pending roll is a `getdel`, the message seq is unique per channel, the
  generation job is the universe id (one generation, however many advance
  together), and refunds are ledger reads. Joining twice with the same code
  is the same membership: `user_id` is unique.

## What is deliberately not there

- No strict turn order, no passing a "speaker token": absent players would
  block the table.
- No kick: a host saddled with a code-holder who never writes disbands and
  recreates. Both are cheap, a kick UI is not.
- No own-description inspiration in groups (v1), no mid-generation join, no
  spectator mode, no cross-party encounters: parties live in their own
  universe and the visiting rules are untouched.
