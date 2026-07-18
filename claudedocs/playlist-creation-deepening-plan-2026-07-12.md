# Playlist-Creation Deepening Plan — 2026-07-12

Scope: the five deepening candidates surfaced by the architecture review of
`feat/playlist-creation-from-liked-songs` (branch diff vs `main` + working tree).
Each candidate was independently deep-dived by a dedicated design agent, then every
load-bearing claim was re-verified against the code before landing in this plan.
Vocabulary follows the deepening glossary (module / interface / seam / adapter /
locality / leverage / deletion test); domain vocabulary follows
`docs/playlist-creation/conceptualization.md`.

---

## Validation summary

All five designs were verified. Two findings upgraded during validation:

1. **Latent production bug (confirmed by direct code reading).** After a submit
   returns `reconnect-required` or `extension-unavailable`,
   `CreateBar.tsx` never resets `isSubmitting` (only `error`/throw do, lines
   118–131) and the component never unmounts — gate prompts are early returns
   inside the same fiber (lines 135–140), and the screen's footer keeps rendering
   `CreateBar` because `handleCreateResult` leaves `flowResult` null for gate
   failures (`CreatePlaylistScreen.tsx:263–269`). Once the user reconnects and
   `gateState` returns to `"ok"`, the CTA renders permanently disabled
   (`canSubmit` requires `!isSubmitting`). Fixed structurally by Workstream C.

2. **Fabricated stub variant (confirmed).** `src/__mocks__/billing.functions.stub.ts:25`
   declares `{ success: false; error: "billing_service_error"; message: string }`,
   which does not exist in the real union (`src/lib/server/billing.functions.ts:82–97`);
   the stub is also missing the real `invalid_songs`, `unlimited_access_active`,
   and `internal_error` variants. This is worse drift than the originally-reported
   `playlistId` omission.

Corrections to the original review's diagnosis, confirmed during validation:

- `FREE_BILLING_STATE` **already exists** (`src/lib/domains/billing/state.ts:90–98`)
  with a doc comment stating it is "the single source so the two paths can never
  drift" — the duplicated literals in `playlist-draft.functions.ts` violate its
  stated purpose rather than reveal a missing concept.
- Testing `createServerFn` handlers was **never blocked**: 16 files in
  `src/lib/server/__tests__/` use an established `vi.mock("@tanstack/react-start")`
  builder idiom (see `playlists.functions.test.ts:41–60`). The missing test file
  for `playlist-draft.functions.ts` is an oversight, not an architectural
  constraint. The extraction in Workstream B is therefore justified on
  module-boundary grounds (multi-domain orchestration stranded in `src/lib/server/`),
  not testability.
- The client comment claiming a paging-constant mismatch "never affects
  correctness" is **false at the product level**: client stride vs server window
  width mismatch produces either repeated suggestions on every refresh
  (stride < 12) or permanently skipped ranked candidates (stride > 12). Verified
  against the clamp math in `assembleDraft` (`draft-engine.ts:325–338`).
- `docs/playlist-creation/partial-retry-proposal.md` §4.4 (lines 126–133) plans to
  generalize `isRetryingUnsynced`/`handleRetryUnsynced` into a shared
  `isRetrying` + `handleResumeCreate` — i.e. upcoming work will re-implement the
  commit-flow lifecycle on top of the current leaky seam unless Workstream C
  lands first. This is the strongest sequencing argument in the plan.

---

## Execution order

```
E (paging constant)      ─┐  independent, ~30 min, zero risk
D (stub conformance)     ─┤  independent, ~1–2 h, zero runtime risk
A (billing reader)       ─┬─ foundation for B
B (workflow extraction)  ─┘  edits the same file as A — same PR or strictly after
C (commit-flow hook)     ──  independent of A/B (client vs server layers); do
                             BEFORE implementing partial-retry-proposal §4.4
```

Sequence: **E → D → A → B → C**. A and B touch `playlist-draft.functions.ts` —
do not parallelize them across branches.

---

## Workstream A — one home for "billing unreadable → assume free tier"

Candidate 4. The degrade-on-read-failure half of `FREE_BILLING_STATE`'s stated
purpose was never wired up; three production sites hand-author the fallback, and
three of four degrade sites log nothing (a billing-read outage is invisible today).

### Audit (validated)

| Site | Today | Action |
| --- | --- | --- |
| `playlist-draft.functions.ts:130–141` (`previewPlaylistDraft`) | hand-rolled 9-field literal, no logging | replace with reader |
| `playlist-draft.functions.ts:366–377` (`persistNewPlaylistConfig`) | identical literal, no logging | replace with reader |
| `features/playlists/create/intentEligibility.ts:25–28,39` | hand-authored `LOCKED_GATE_FALLBACK` VM | delete; derive via `buildIntentGate` |
| `workflows/library-processing/scheduler.ts:243` | already uses `FREE_BILLING_STATE`, no logging | migrate to reader (logging consistency) |
| ~10 test/story fixtures with local free-tier literals/factories | fine functionally | repoint to shared `makeBillingState(overrides)` fixture |

Verified equivalence: `hasUnlimitedAccess(FREE_BILLING_STATE)` → `"none" !== "none"`
→ `false`, so `buildIntentGate(FREE_BILLING_STATE)` produces exactly
`{ allowed: false, criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: false }] }`
— byte-identical to `LOCKED_GATE_FALLBACK`. Safe deletion.

### Design

New reader in `src/lib/domains/billing/queries.ts` (observability import has
domain-layer precedent: `domains/billing/unlocks.ts`, `domains/library/accounts/onboarding-allocation.ts`):

```ts
export async function readBillingStateOrFreeTier(
  supabase: AdminSupabaseClient,
  accountId: string,
  operation: string,
): Promise<BillingState> {
  const result = await readBillingState(supabase, accountId);
  if (Result.isOk(result)) return result.value;
  captureServerError(result.error, { area: "billing", operation, accountId });
  return FREE_BILLING_STATE;
}
```

Each call site collapses from ~12 lines of branching + literal to one line.
Use `captureServerError`, not `console.error` (the web server runs with
`enableLogs: false`, so `console.*` never reaches Sentry).

### Tasks

1. Add `readBillingStateOrFreeTier` to `domains/billing/queries.ts`.
2. Replace both literals in `playlist-draft.functions.ts`
   (operations: `"preview_playlist_draft"`, `"persist_new_playlist_config"`).
   If Workstream B runs in the same PR, make the change inside the extracted
   workflow modules instead. Also migrate `scheduler.ts:243` to the reader so
   its degrade path logs like the others.
3. Rewrite `getIntentEligibility` to
   `buildIntentGate(await readBillingStateOrFreeTier(...))`; delete
   `LOCKED_GATE_FALLBACK`.
4. Tests: extend `domains/billing/__tests__/queries.test.ts` with a
   `readBillingStateOrFreeTier` block (fallback returned + `captureServerError`
   called on error; not called on success). New
   `features/playlists/create/__tests__/intentEligibility.test.ts` pinning the
   degrade output VM (currently zero tests for this function).
5. Add shallow `Object.freeze(FREE_BILLING_STATE)` in `state.ts` (cheap insurance;
   nothing mutates `BillingState` anywhere today).
6. Separate commit: `domains/billing/fixtures.ts` with
   `makeBillingState(overrides: Partial<BillingState>)`, repoint ~10 fixture
   sites. Three suites intentionally override fields (`unlocks.test.ts`,
   `useCheckoutFlow.test.ts`, `provider-disabled-validation.test.ts`) — the
   overrides parameter preserves them.

**Risk note:** this change surfaces Sentry signal for billing-read failures for
the first time — flag in the PR description so new alerts aren't mistaken for a
regression.

---

## Workstream B — extract the draft preview/commit orchestration into a workflow

Candidate 1. `playlist-draft.functions.ts` (528 lines, zero tests) mixes four
domains (billing, library, taste, enrichment) inside handler bodies —
workflow-shaped code stranded in `src/lib/server/`, per
`docs/architecture/module-boundaries.md` ("workflows coordinate domain/platform
modules"). Do **not** extract into `domains/playlists/` — a multi-domain
coordinator inside one domain would invert the boundary rule.

### Design

New `src/lib/workflows/playlist-studio/` — the server side of the create
screen's studio session. Named `playlist-studio` (not `playlist-creation`) to
keep the latter free for a possible future from-scratch create feature.
(Pattern precedent:
`workflows/library-processing/scheduler.ts`, which coordinates billing + library
+ taste and is tested via plain module mocks):

- **`preview.ts`** — `runPreviewPlaylistDraft(supabase, accountId, input)`:
  body of `previewPlaylistDraft` handler (lines 120–254) moved verbatim, billing
  literal replaced by Workstream A's reader.
- **`commit.ts`** — `runPersistNewPlaylistConfig(supabase, accountId, input)`
  (body of lines 334–452) and `runRecordPlaylistMatchDecisions(accountId, input)`
  (body of lines 483–528). Keep them as **two separate exported functions**: each
  has its own ownership re-check by design (defense in depth — see the comment at
  line 491); do not "share" the check in a future refactor.
- **No injected deps object.** The repo convention is module-level `vi.mock` of
  imported query/service modules (scheduler.test.ts and all 16 server-fn suites);
  a `deps` parameter would be a novel pattern here.
- `playlist-draft.functions.ts` becomes a thin adapter: zod schemas +
  `createServerFn().middleware([authMiddleware]).inputValidator(...)` + one-line
  handlers, re-exporting result types
  (`export type { PreviewPlaylistDraftResult } from "@/lib/workflows/playlist-studio/preview"` —
  a single named type re-export, not a barrel).
- `resolveSpotifyUserId` stays in the server-fn file (one-line context read,
  genuinely shallow).

Blast radius verified: `features/playlists/create/queries.ts` imports only the
callable; `useCreatePlaylistDraft.ts` imports only the type (satisfied by the
re-export); the Ladle alias (`ladle-vite.config.ts`) keys on the module path,
which doesn't change; `create-playlist-from-draft.ts` imports callables only.

### Tasks

1. Create `workflows/playlist-studio/preview.ts` + `commit.ts`; move bodies
   verbatim; adopt `readBillingStateOrFreeTier`.
2. Rewrite `playlist-draft.functions.ts` as the adapter; keep export names and
   call shapes identical.
3. Update `draft-engine.ts:7` header comment to point at the workflow module.
4. `bun run test` — confirm downstream untouched.
5. `workflows/playlist-studio/__tests__/preview.test.ts`:
   - degrade to free tier on billing error → `intentApplied` false even with intent
   - ineligible account: client intent ignored, `EmbeddingService.create` never called
   - eligible + blank/whitespace intent → pills-only
   - `EmbeddingService.create()` err → pills-only; `embedText` err → pills-only,
     `intentApplied` false
   - stored embedding as JSON string → parsed; already-array → passed through
     (the `JSON.parse` hazard, lines 203–207)
   - song-embeddings fetch err with successful intent embedding →
     `intentApplied` stays true, map undefined (silent branch, line 201)
6. `workflows/playlist-studio/__tests__/commit.test.ts`:
   - playlist not found / wrong `account_id` → throws (lines 346–351)
   - intent dropped when ineligible despite `intentApplied: true`; dropped when
     eligible but `intentApplied: false` (AND-gate, 384–389)
   - **fail-closed**: ownership lookup err → empty `trackUris`, no throw, never
     trusts caller ids (430–436)
   - non-owned ids silently dropped from URI list, caller order preserved (444)
   - `getSongsByIds` err → empty `trackUris`, no throw (417–425)
   - invalid match filters → throws before any write (393–396)
   - `runRecordPlaylistMatchDecisions`: playlist lookup fail → throws; non-owned
     ids filtered before upsert; returns 0 when none owned (own fixtures — do not
     share with the persist tests)
7. Slim `server/__tests__/playlist-draft.functions.test.ts` (adapter wiring only,
   ~4–6 tests): accountId threading, zod rejection before workflow call,
   `resolveSpotifyUserId` context read.

---

## Workstream C — one module for the commit-flow lifecycle (fixes the stuck-CTA bug)

Candidate 2. One state machine
(`idle → submitting → {success | partial | created-unsynced → retrying} | gate-failure | error`)
is split across `CreateBar` (submit + payload assembly + `isSubmitting`),
`CreatePlaylistScreen` (shadow `FlowResult` union, `submittedNameRef`,
`submittedInputRef`, retry), with `onNameCommit`/`onSubmitInput` existing purely
to smuggle snapshots up the tree. The boundary is temporal, not informational.

### Design

New `src/features/playlists/create/useCreatePlaylistFlow.ts` (sibling to
`useSpotifyGate.ts`; `create-flow/` stays presentational-only):

```ts
export type CreatePlaylistFlowResult =
  | (Extract<CreatePlaylistFromDraftResult, { status: "success" }> & { playlistName: string })
  | Extract<CreatePlaylistFromDraftResult, { status: "partial" }>
  | Extract<CreatePlaylistFromDraftResult, { status: "created-unsynced" }>;

export interface UseCreatePlaylistFlow {
  result: CreatePlaylistFlowResult | null;
  isSubmitting: boolean;
  isRetryingUnsynced: boolean;
  submit: (input: CreatePlaylistFlowSubmitInput) => Promise<void>;
  retryUnsynced: () => Promise<void>; // no args — reads its own private snapshot
}

export function useCreatePlaylistFlow(args: {
  reportGateFailure: (failure: SpotifyGateFailure) => void;
}): UseCreatePlaylistFlow;
```

Key decisions (validated against the code):

- `submit(input)` takes `name` as a **call-time argument** — kills `onNameCommit`;
  the async-boundary staleness problem is solved by argument passing, not refs.
- The submitted-input snapshot is **private** to the hook; `retryUnsynced()` takes
  no args, making "resume with the original input even after config edits" a
  structural guarantee. Do not expose a getter for it.
- Result mapping is one exhaustive `switch` with `default: raw satisfies never` —
  a new orchestrator status becomes a compile error, not a silent no-op (today's
  `if/else` chain fails the deletion test: removing a branch still compiles).
- `isSubmitting` resets to `false` in **every** terminal branch — the stuck-CTA
  fix falls out of correct design rather than a patch.
- Hook takes only `reportGateFailure` (narrowest gate slice), not the whole gate.
- `FlowResult` derived via `Extract<>`, never re-declared.
- Focus management (`resultRegionRef` + effect) and the page-title name input stay
  in the screen — DOM/a11y concerns, correctly screen-owned.
- `CreateBar` becomes fully presentational, 12 props → 7:
  `{ name, songIds, isPreviewStale, isSubmitting, gateState, recheck, onSubmit }`.
  Deleted: `genrePills`, `matchFilters`, `intentApplied`, `intent`,
  `onNameCommit`, `onSubmitInput`, `onResult` (the four config props were never
  read for rendering — payload assembly moves to the screen's `handleSubmit`).

### Tasks

1. Write `useCreatePlaylistFlow.ts`.
2. `__tests__/useCreatePlaylistFlow.test.ts` (plain `renderHook` tests, mocked
   orchestrator): submit→success (with `playlistName`); submit→partial;
   submit→created-unsynced→`retryUnsynced()`→success; **resume-uses-original-input**
   (submit A → unsynced → retry → assert `resumePlaylistCreateFromDraft` called
   with A verbatim); gate-failure routing (both statuses → `reportGateFailure`,
   `result` stays null, **`isSubmitting` resets — regression test for the bug**,
   second submit reaches the orchestrator); error → toast, retryable; throw →
   generic toast, retryable.
3. Strip `CreateBar.tsx` to the presentational interface; delete the orchestrator
   import.
4. Update `CreateBar.test.tsx`: delete the orchestrator `vi.mock` (the clearest
   signal the seam closed), delete submit-payload/result-mapping/duplicate-guard
   blocks (superseded by hook tests + structural guarantees), rewrite
   `aria-busy`/disabled tests to drive `isSubmitting` as a prop. Keep
   name/CTA-label/gate-prompt tests. `PartialState`/`SuccessState`/`UnsyncedState`
   blocks unchanged.
5. Refactor `CreatePlaylistScreen.tsx`: delete `FlowResult`, both refs,
   `isRetryingUnsynced`, `handleCreateResult`, `handleRetryUnsynced`; wire the
   hook; retarget footer ternary + focus effect to `flow.result`.
6. Update all 5 `CreateBar` call sites: `CreatePlaylistScreen.tsx`,
   `PlaylistCreation.composable.stories.tsx:492`,
   `PlaylistCreation.atoms.stories.tsx:305,338,364`.
7. `bun run test`, typecheck, `bun run ladle:build`; sanity-check the
   Ready/Reconnect/ExtensionMissing stories.

**Sequencing constraint:** land this workstream before partial-retry-proposal
§4.4, which would otherwise bake the leaky seam in a third time.

---

## Workstream D — stub conformance: import the interface, never copy it

Candidate 3, expanded by a full audit of `src/__mocks__/`. The Ladle alias seam is
bundler-only (no matching tsconfig `paths`), so TypeScript always checks prod code
against the real types — drifted stubs produce runtime shapes that contradict the
checked types, silently, only inside Ladle. `import type` is erased syntactically
before module resolution, so it can never pull the server graph (drizzle/postgres/
supabase via authMiddleware) into the Ladle bundle. Three of nine stubs already do
this correctly (`create-playlist-from-draft.stub.ts`, `intentEligibility.stub.ts`,
`playlists.functions.stub.ts` in part) — the fix is applying the in-repo pattern
to the rest.

### Drift audit (validated)

| Stub | Drift | Severity |
| --- | --- | --- |
| `billing.functions.stub.ts:12–25` | fabricated `billing_service_error` variant; missing real `invalid_songs` / `unlimited_access_active` / `internal_error` | **highest** |
| `playlist-draft.functions.stub.ts:21–23,49–50` | `PersistNewPlaylistConfigResult` missing `playlistId`; `recordPlaylistMatchDecisions` resolves void vs `{ recorded: number }`; false "(re-exported verbatim)" comment | high, currently dormant¹ |
| `onboarding.functions.stub.ts:17–53` | missing `accountId`, `claimHandleSeed`, `spotifyId`; `phaseJobIds`/`syncStats` types diverge; `landingSongs` shape hand-copied | medium-high |
| `account-handle.functions.stub.ts:16–38` | in sync today, hand-copied (preventive fix) | none yet |
| `playlists.functions.stub.ts` | inline shapes verified in sync | none yet |

¹ Dormant because Ladle also wholesale-stubs the *orchestrator* that calls these
functions, so no story exercises them — the "double stub" for one flow is itself
redundant and will detonate if ever collapsed.

### Fix pattern (per stub)

Type-only import every result interface from the real module + `satisfies` on each
constructed literal:

```ts
import type { PersistNewPlaylistConfigResult } from "@/lib/server/playlist-draft.functions";

export const persistNewPlaylistConfig = (_opts: unknown) =>
  Promise.resolve({
    trackUris: [],
    playlistId: "stub-playlist-id",
  } satisfies PersistNewPlaylistConfigResult);
```

Enforced by `bun run typecheck` in CI today — no new tooling. Skip whole-module
`satisfies typeof import(...)` (stubs legitimately add setters and loosen inputs)
and skip callable-signature parity with `createServerFn` wrappers (structurally
different by design).

### Tasks

1. `playlist-draft.functions.stub.ts` — type-import, add `playlistId`, fix
   `recordPlaylistMatchDecisions` return, fix the false comment.
2. `billing.functions.stub.ts` — replace all hand-copied response types with
   type-only imports; delete the fabricated variant (verified 2026-07-12: its
   only occurrence in the codebase is the stub's own declaration — zero
   consumers, safe to delete).
3. `onboarding.functions.stub.ts` — type-import `OnboardingData`,
   `OnboardingPlaylist`, `SyncStats`, `ReadyCopyVariant`, `PhaseJobIds`,
   `LandingSongManifest`.
4. `account-handle.functions.stub.ts` — convert to type-only imports (preventive).
5. `playlists.functions.stub.ts` — `satisfies`-check remaining inline literals
   (lowest priority).
6. Comment hygiene: replace "verbatim" claims with the actual mechanism.
7. One shared `src/__mocks__/__tests__/stub-types.test.ts` with
   `expectTypeOf` for pure input-type re-exports (precedent:
   `domains/enrichment/lyrics/__tests__/queries.test.ts`).
8. Verify with `bun run typecheck` + `bun run ladle:build` (locally — Ladle is
   intentionally not a CI concern; the `satisfies` + type-only-import pattern
   makes drift a `bun run typecheck` failure, which CI already gates on).

---

## Workstream E — one canonical paging constant at the seam

Candidate 5. Client stride (`SUGGESTIONS_PAGE_SIZE`,
`useCreatePlaylistDraft.ts:33`) and server window width (`SUGGESTIONS_COUNT`,
`draft-engine.ts:268`) are the same contract declared twice. Verified degradation
on divergence: stride < width → every refresh repeats `width−stride` songs;
stride > width → `stride−width` ranked candidates per page are silently never
surfaced. Nothing tests `refreshSuggestions` today, so divergence would ship
unnoticed.

The client's decoupling instinct was right; the constant's *location* was wrong —
it's interface, not implementation. Exact in-repo precedent:
`domains/library/liked-songs/constants.ts` ("lives in its own module … so the
client bundle can import the page size without pulling in the server-only client").

Rejected alternative (documented so it isn't re-proposed): server-returned
`nextOffset`/page size in `PreviewPlaylistDraftResult`. YAGNI while the size is
static, and it would make `refreshSuggestions` (currently synchronous local state)
dependent on query lifecycle — new pending/error edge cases for zero present
benefit.

### Tasks

1. New `src/lib/domains/playlists/constants.ts` exporting
   `SUGGESTIONS_COUNT = 12` with a doc comment naming it the paging contract
   between `useCreatePlaylistDraft` and `assembleDraft`.
2. `draft-engine.ts`: delete the local export (verified: no other importers),
   import from `./constants`.
3. `useCreatePlaylistDraft.ts`: delete `SUGGESTIONS_PAGE_SIZE` + its
   four-line justification comment; import the shared constant;
   `refreshSuggestions` advances by it.
4. Tests: retarget the existing no-overlap suggestions-paging test in
   `draft-engine.test.ts` to import the shared constant instead of a literal 12;
   add a hook-level test asserting `refreshSuggestions` advances the offset by
   exactly `SUGGESTIONS_COUNT` (first coverage of `refreshSuggestions` at all).
5. `bun run test`.

---

## Cross-cutting verification (after each workstream)

- `bun run test` (Vitest), `bun run typecheck`
- `bun run ladle:build` for workstreams C and D (story surface changes)
- Grep-checks: no remaining `plan: "free" as const` production literals (A),
  no remaining `SUGGESTIONS_PAGE_SIZE` (E), no plain value-imports of real
  modules in stubs (D)

## Explicitly deferred / rejected

- Server-driven suggestions page size (E) — revisit only if the size becomes
  per-plan/per-experiment dynamic.
- Whole-module stub `satisfies typeof import(...)` and callable-signature parity
  (D) — fights intentional stub divergence.
- `deps`-object injection for the workflow extraction (B) — inconsistent with
  every sibling workflow/server-fn test in the repo.
- Tests-without-extraction for B (writing the workflow suites against the
  current server-fn file) — rejected 2026-07-12 in favor of the full
  extraction; the multi-domain orchestration should not stay in `src/lib/server/`.
- Module names `playlist-creation` / `playlist-drafting` / `create-playlist`
  for B — `playlist-creation` is reserved for a possible future from-scratch
  create feature; `playlist-studio` chosen 2026-07-12.
