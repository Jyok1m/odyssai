# What the models cost

`llm_usage` logs **every** call, whatever its entry point. Before it, five of the eight call points threw their usage away, including world generation, which makes seven to twenty-three of them: the data was computed by `narrator` and nobody read it.

- Without that log, no subscription scale can be anything but an opinion. **One does not price what one does not measure.**
- `cost_usd` is a `Decimal(12,8)`, not a `Float`: a cost adds up over thousands of rows and the binary drifts there.
- The relation to `users` is in **`SetNull`**: the accounting survives a player's departure, detached from him. What remains is a cost, no longer a person.
- A failed write is logged, never retried: the player already got his answer, and the accounting is not worth breaking a turn. Same rule as the guide log.
- `guide_questions` keeps its own log and **stays anonymous**: it has no player to attach, and it is a design decision, not an oversight.
- The cost returned by the provider wins; otherwise it computes from the tokens, billing reasoning tokens at the output rate, which both providers do.
- Watch the two `LLM_NARRATOR_PRICE_*`: **at zero, the computed fallback writes a false freebie** the day OpenRouter stops returning the cost. They are scale values, not a switch.
- Measured on `qwen/qwen3.5-35b-a3b`: a turn **0.0012 $** on average, a world generation **0.0040 $** without replay. A world is thus worth three turns, not twenty-five. The 25 credits it costs are insurance against the graph's replays and a subscription lever, **not the reflection of a cost**, and it is accepted as such.
- A turn's input rises from 3 800 to 6 900 tokens between the first and the twelfth, then stabilizes: it is `recentTurns` filling up. It is the dial weighing the most on the cost of a turn.
- The cost of the same turn varies **from simple to quadruple** at equal size, depending on the provider OpenRouter routes to. Pricing on a single measure thus makes no sense: one needs an average and a worst case.
- **LangSmith's cost comes from OpenRouter, never from a scale.** Its `wrapOpenAI` wrapper only read the standard OpenAI usage fields and ignored OpenRouter's `cost`: it saw tokens, never the spend. Declaring a per-model scale to it would have given a wrong figure for the reason above, the route varying from one call to the next. It is **Broadcast** that settles that, by broadcasting the real cost and the provider actually routed. The accounting stays `llm_usage`: two sources measuring the same thing, one to price, the other to reread a call.
- **Embeddings are not traced**: `embed()` goes through the bare client. There is neither streamed text nor prompt to reread, and their usage is logged like the rest.

## Observability goes through OpenRouter, no longer through the SDK

`wrapOpenAI` disappeared from `packages/llm`: it is **Broadcast** that broadcasts the traces to LangSmith, configured at OpenRouter and not in this repo.

- **The linking goes through the request body.** The metadata (`turn_id`, `universe_id`, `guide_question_id`, `prompt_version`, `band`, `situation`) went through `langsmithExtra`, LangSmith client-side; they now go in OpenRouter's `trace` field. Without them, a trace would arrive right but orphaned, impossible to link to a turn or to a `llm_usage` row. It is the only place where that link exists: the gateway returns no identifier.
- That field is **specific to OpenRouter** and is only set for it, like the keys of `OPENROUTER_ONLY_BODY_KEYS`: the OpenAI API rejects what it does not know. A test checks it both ways.
- **No `user` field is sent.** OpenRouter accepts one, but `guide_questions` already carries neither address nor player identifier: it is not for the gateway to receive one.
- **Sampling disappeared with the SDK**: Broadcast traces everything. `GUIDE_TRACE_SAMPLE_RATE` and `GUIDE_TRACE_HIDE_IO` no longer exist, and `guide_questions.traced` is no longer written, pending removal at the next deployment.
- What is gained along the way: **moderation is traced** without a line of code, it which was not, and the **provider actually routed** appears, the only way to explain that the same turn varies from simple to quadruple.
- The `langsmith` SDK **remains a dependency of `apps/api`**: `eval:guide` and `eval:narration` use it for their case sets and their experiments (`createDataset`, `evaluate`), which Broadcast cannot do. It left `packages/llm` and `apps/worker`, which only used it to trace.
- `LANGSMITH_TRACING` keeps its name so as not to touch the ansible role, but no longer says more than this: the credentials are filled, for the evaluations.
- Consequence to know: an evaluation run now produces **two runs per call**, that of `evaluate()` and that of Broadcast, which is attached to no experiment. An API key dedicated to evaluations, excluded from the destination, is the way to separate them.
