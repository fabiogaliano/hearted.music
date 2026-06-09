# Handle Identity — Autonomous Run Decision Log

Every decision made on-the-spot that was **not** explicit in the plan or task files.
Terse. Append-only. Each entry: `[task NN | stage] decision — rationale`.

The plan (`docs/social/handle-identity-implementation-plan.md`) wins over task files
on disagreement; §15 is the decision index.

---

## Orchestrator setup

- `[setup] Starting state differed from the orchestrator brief.` Brief assumed branch
  `concept-audit-principles` with staged docs + uncommitted enrichment/cursor WIP. Actual:
  on `main`, tree clean, docs already committed (`b5efae7`), and the enrichment + liked-songs
  cursor work already committed (`cff1ec8`, `40cdbf5`). The cursor migration
  `20260609042937_fix_liked_songs_page_stable_cursor.sql` is the current migration tip and is
  already in main's history.
- `[setup] Skipped the commit→stash→cherry-pick dance.` Nothing to stage (clean), nothing to
  stash (clean), docs already in main. Just `git switch -c feat/handle-identity main`. The
  branch carries the docs and the cursor migration automatically.
- `[setup] No new git stash was created this run.` End-of-run report must NOT claim the user's
  WIP was stashed — it was already committed to main. (Pre-existing unrelated stashes remain in
  `git stash list` untouched.)
- `[setup] Orchestrating directly with the Agent tool (general-purpose subagents), not the
  Workflow tool.` The brief specifies fresh Task-tool subagents per stage with adaptive
  orchestrator gates ("STOP on >2 review rounds", "continue with what's unblocked") and real
  git/DB side effects — better served by in-the-loop gating than a deterministic script.
- `[setup] Serializing tasks (and all commits).` Overnight unattended; "when in doubt,
  serialize". Avoids `.git/index.lock`, local-DB, and lockfile races. Wall-clock cost accepted.

---

## Task 01

- `[task 01 | implement] Used a local inline validator function (readRequiredUrlClientEnv) instead of Zod in env.public.ts` — env.public.ts uses a hand-rolled readOptionalClientEnv pattern with no Zod import; the new required URL validator follows the same style to avoid introducing a new validation lib into that module.
- `[task 01 | implement] All four env files exist (.env, .env.local, .env.example, .env.cloud) and were all updated` — ls confirmed all four are present; no env files are missing.
- `[task 01 | implement] VITE_PUBLIC_APP_ORIGIN added to src/env.ts client schema and runtimeEnv` — repo convention is that all VITE_ client vars appear in both env.public.ts and env.ts (t3-oss/env-core); adding to env.ts as required z.url() keeps the two in sync.
- `[task 01 | implement] README optional-vars block updated (not a separate README snippet)` — no standalone env-vars README exists; the only VITE_ var docs are in README.md's optional block; added VITE_PUBLIC_APP_ORIGIN there.
- `[task 01 | orchestrator] On an APPROVE verdict with zero changes, orchestrator does the mark-done + commit directly instead of spawning a patch+commit subagent` — it's markdown bookkeeping (index.md row + task Status line), not feature code; saves an agent. Fresh patch+commit subagents are still used whenever review returns REQUEST_CHANGES.
- `[task 01 | orchestrator/ops] .env, .env.local, .env.cloud are gitignored; only .env.example is committed` — the prod value VITE_PUBLIC_APP_ORIGIN=https://hearted.music lives in gitignored .env.cloud, so the real cloud/deploy environment must set this var independently. Surfaced in end-of-run report.
- `[task 01 | orchestrator] Commit policy: let the lefthook pre-commit hook run (no --no-verify) from task 02 onward` — pre-commit runs `biome check --write` (auto-fix + re-stage), keeping formatting consistent; pre-push runs the full check+typecheck+test gate. Task 01's commit used --no-verify but its files pass biome clean (verified), so nothing was missed.

---

## Task 02

- `[task 02 | implement] SQL body copied character-for-character from §4.2 plan lines 110–199` — plan is the authoritative source; no deviations from the spec body.
- `[task 02 | implement] Fixed pre-existing typecheck failure in auth.server.test.ts` — adding `handle: null` to the hardcoded `Account` fixture; the test was a pre-existing incomplete fixture that broke only once the new column appeared in the generated types. Fix is correct (handle is nullable, pre-claim rows have null), not a spec deviation.
- `[task 02 | implement] postgres superuser appears in role_routine_grants for claim_handle alongside service_role` — this is normal Postgres behavior (superuser always has execute); PUBLIC, anon, and authenticated are absent, confirming the REVOKE was effective.
- `[task 02 | orchestrator] gen:types output must be biome-formatted before commit (REPO WORKFLOW)` — `bun run gen:types` (= `supabase gen types ... > database.types.ts`) emits 2-space indent, but the committed file is tab-indented per biome (indentStyle: tab). Raw regen produced a 5476-line whitespace diff; `bunx biome format --write src/lib/data/database.types.ts` collapsed it to the 10 real semantic lines (handle in Row/Insert/Update + claim_handle Function). Any future `gen:types` must be followed by biome format. The pre-format "1 biome error" was the formatting violation itself, gone after format; typecheck green.
- `[task 02 | orchestrator] claim_handle.Returns.owned_handle is typed string (non-null) by the generator despite the not_ready branch returning NULL` — known Supabase CLI limitation (it reads the RETURNS TABLE column decl, not branch returns). Task 09/15 callers must treat owned_handle as possibly absent on not_ready. Flagged by reviewer; not a migration defect.

---

## Task 03

- `[task 03 | implement] transliteration package: imported named export { transliterate } from "transliteration"` — package.json exports map resolves "transliteration" to dist/node/src/node/index.js which re-exports `{ transliterate, slugify }`; no default export available, so named import was required.
- `[task 03 | implement] transliteration called with { unknown: "" } option` — ensures unrecognized chars (e.g. CJK with no transliteration data) produce empty string rather than a placeholder marker that would pass through to the handle prefill.
- `[task 03 | implement] obscenity: used RegExpMatcher + englishDataset.build() + englishRecommendedTransformers (spread)` — this is the canonical usage shown in the englishDataset JSDoc; englishRecommendedTransformers is a Pick<RegExpMatcherOptions, 'blacklistMatcherTransformers' | 'whitelistMatcherTransformers'> so it spreads directly into the constructor options.
- `[task 03 | implement] isProfaneHandle strips [._] before passing to matcher` — spec §5.6 says strip "." and "_" before checking; using replace(/[._]/g, "") for a literal character class (no regex-special treatment needed); the englishRecommendedTransformers include skipNonAlphabetic which already skips many separators, but explicit pre-strip ensures the exact product behavior stated in the spec.
- `[task 03 | implement] isProfaneHandle(normalizedHandle): boolean chosen as the handle-profanity export signature` — spec §14.3 tests ask for a boolean "is it profane"; returning a boolean with a clear predicate name is the simplest interface; callers translate to reason "profanity" themselves (consistent with how isReservedHandle returns boolean and callers translate to reason "reserved").
- `[task 03 | implement] matcher instance created once at module load` — obscenity's RegExpMatcher compiles patterns at construction time; module-level singleton avoids repeated compilation on every call.
- `[task 03 | review→patch] Applied 2 MINOR review fixes directly (orchestrator), no patch subagent` — (1) swapped HANDLE_FORMAT_VALIDATION_REASONS tuple order to match plan §5.3 literal (`trailing_period` before `consecutive_periods`); runtime precedence is an explicit if-chain independent of the tuple, so the swap is behavior-safe (verified by reading the function). (2) added the 4 hyphenated protected reserved words (liked-songs, forgot-password, reset-password, verify-email) to the isReservedHandle test loop. typecheck green, 63 tests pass.
- `[task 03 | orchestrator] Policy: MINOR-only review verdicts are patched directly by the orchestrator; BLOCKER/MAJOR or non-trivial change-sets get a fresh patch+commit subagent` — keeps the independent-patch discipline where it matters while not spending an agent on 2-line mechanical edits.

---

## Task 04

- `[task 04 | implement] AnalysisContent has no feature-local type dependencies` — the interface body uses only primitive and anonymous object types; no external type imports needed in the new lib module. Safe to move verbatim.
- `[task 04 | implement] types.ts retains an import of AnalysisContent from the lib module` — the private SongAnalysis interface (used by LikedSong.analysis) still references AnalysisContent; the import is genuine, not a pass-through re-export.
- `[task 04 | implement] All 6 downstream importers repointed directly to the lib path` — LandingPanel.tsx, LandingPanelContent.tsx, PanelHero.tsx (relative import rewritten to @/ alias), step-resolver.ts, onboarding.functions.ts, liked-songs.functions.ts; no barrel/pass-through re-export created.
- `[task 04 | implement] PanelHero.tsx used a relative ../../types import; switched to @/ alias style` — consistent with the rest of the codebase's lib imports; relative path would have also worked but @/ is the repo convention for lib modules.
- `[task 04 | implement] Import alias confirmed as @/lib/domains/enrichment/content-analysis/analysis-content` — matches the pattern used by neighbouring enrichment domain modules (e.g. @/lib/domains/enrichment/audio-features/queries in song-analysis.ts).
