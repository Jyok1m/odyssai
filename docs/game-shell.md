# Generation screen and game shell

- Progress reads from `generation_jobs` through a `GET /onboarding/generation` in SSE, which rereads the table every two seconds. **No Redis channel published by the worker**: the table is already the source of truth, it survives a restart, and two api instances read the same thing from it.
- The stream closes by itself after ten minutes and the browser reopens: a generation may be slow, not indefinitely.
- The `failed` step reopens the inspiration in the assistant: it is the only exit of a generation that did not complete, and the API accepts a write for that reason.
- The page title is carried by `OnboardingWizard`, not by `page.tsx`: once the world is generated, the screen is no longer a path and does not want one.
- The world tint goes through `--world-hue` under `[data-world]`, as the kit plans it. Do not write `--accent` by hand: it would bypass the rule instead of following it, and lose its transition.
- The game turn input field is **present and inert**, and says so. The turn does not exist yet, and making believe otherwise would be worse than an absence.
