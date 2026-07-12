# Orchestration Deviation Log — Playlist-Creation Deepening

Plan: `claudedocs/playlist-creation-deepening-plan-2026-07-12.md`
Sequence: E → D → A → B → C

This log records decisions made during execution that were **not** spelled out in
the plan, with a one-line rationale each. Empty sections mean execution matched the
plan exactly.

## Orchestration-level decisions

- (none yet)

## Workstream E — paging constant

- Plan cites `draft-engine.ts` as living at `src/lib/server/draft-engine.ts`; the
  actual file is `src/lib/domains/playlists/draft-engine.ts` (already a pure-domain
  module, matching its own header comment). Placed the new
  `src/lib/domains/playlists/constants.ts` as a sibling of the real file, not
  under `src/lib/server/` — consistent with the plan's own precedent reference
  (`domains/library/liked-songs/constants.ts`) and with the doc comment's framing
  of the constant as domain interface, not server implementation.
- New hook-level test file placed at
  `src/features/playlists/create/__tests__/useCreatePlaylistDraft.test.tsx`
  (not `.ts`) since it needs a `QueryClientProvider` JSX wrapper, following the
  established pattern in `src/features/matching/__tests__/useMatchReviewCard.test.tsx`.
  `previewPlaylistDraft` (from `@/lib/server/playlist-draft.functions`) is mocked;
  the assertion reads `suggestionsOffset` off the mock's call args after each
  `refreshSuggestions()`, since the hook doesn't expose the offset directly.
- Retargeted only the single test named for "no overlap" paging
  (`"suggestionsOffset pages the suggestions window deeper into the ranked pool"`)
  to the shared constant, per the plan's singular reference to "the existing
  no-overlap suggestions-paging test." Left the unrelated literal `12`s elsewhere
  in `draft-engine.test.ts` (e.g. "suggestions contains up to 12 songs...") as
  literals — those assert a general behavior, not the paging contract itself.

## Workstream D — stub conformance

- `account-handle.functions.stub.ts`: the real `account-handle.functions.ts` already
  exports `CheckHandleAvailabilityResult` and `ClaimHandleAndAdvanceResult` as named
  types (plan described them as hand-copied-but-in-sync, implying no real export
  existed) — switched the stub to `import type` these directly instead of leaving
  the hand-copied duplicates, going slightly beyond "preventive" since the real
  names were already available.
- `onboarding.functions.stub.ts`: real `OnboardingData.syncStats` is `SyncStats`
  (non-nullable), not `SyncStats | null` as the stub had it — an extra divergence
  beyond the ones the plan called out (missing `accountId`/`claimHandleSeed`,
  `phaseJobIds`/`landingSongs` shape). Fixed by importing `OnboardingData` wholesale
  from the real module rather than reconstructing the interface field-by-field.
- `onboarding.functions.stub.ts`: did not add separate `import type { PhaseJobIds }`
  / `import type { LandingSongManifest }` statements as the task list literally
  enumerated — once `OnboardingData`/`OnboardingPlaylist`/`SyncStats`/
  `ReadyCopyVariant` are type-imported wholesale from the real module, those two
  types are already carried transitively inside `OnboardingData.phaseJobIds` /
  `.landingSongs` with no local reconstruction, so a separate import would be an
  unused/dead import (`OnboardingPlaylist` real shape also picked up the missing
  `spotifyId` field this way, with no field-by-field fix needed).
- `onboarding.functions.stub.ts`: left `saveThemePreference`, `executeSync`,
  `resetSyncJobs`, `saveOnboardingStep`, and `markOnboardingComplete` typed as
  resolving `void`/`{success:true}` even though the real handlers return richer
  literals (e.g. `markOnboardingComplete` returns `MarkOnboardingCompleteResult`).
  Out of scope: the plan's task list enumerates only
  `OnboardingData`/`OnboardingPlaylist`/`SyncStats`/`ReadyCopyVariant`/
  `PhaseJobIds`/`LandingSongManifest`, and the core-principle note explicitly
  says not to enforce callable-signature/return parity for `createServerFn`
  wrappers (intentional stub divergence) — these five stay `reject()`-only so
  their resolve type is never observed at runtime.
- `playlists.functions.stub.ts` (task 5, lowest priority): `getAccountTopGenres`,
  `getLikedSongIdsByArtist`, `savePlaylistGenrePills`, and `savePlaylistMatchIntent`
  in the real module have no named exported result interface (inline handler
  return-type annotations only) — added `satisfies` support by type-importing the
  *functions themselves* (`import type { fn as fnReal }`) and deriving
  `Awaited<ReturnType<typeof fnReal>>` locally, rather than leaving them
  unguarded or hand-copying an interface. This is a single-function type
  extraction, not the whole-module `satisfies typeof import(...)` the plan
  rejects.
- `stub-types.test.ts`: the only two "PURE input-type re-exports" found across the
  touched stubs (unmodified `import type` used directly as a callable's parameter
  type, not a hand-copied shape) are `CreatePlaylistFromDraftInput`
  (`create-playlist-from-draft.stub.ts`, already-conformant per the plan) and
  `SavePlaylistMatchConfigInput` (`playlists.functions.stub.ts`). All other
  type-only imports across the touched stubs are *result/response* types, which
  are already guarded in-place by `satisfies` at their construction site — adding
  a redundant `expectTypeOf` assertion for those would just restate the
  `satisfies` check, so the test file only covers the two genuine input types via
  `Parameters<typeof stubFn>[...] toEqualTypeOf<RealInputType>()`.

## Workstream A — billing reader

- `scheduler.ts:executeEffect` operation string chosen as
  `"library_processing_execute_effect"` (not specified by the plan) — the
  effect is generic (enrichment job or match-snapshot-refresh job), so a
  single stable name for the one call site, not one per effect kind, keeps
  the Sentry tag meaningful without multiplying operation strings for what is
  structurally one degrade point.
- `previewPlaylistDraft` / `persistNewPlaylistConfig` operation strings used
  exactly as the plan specified: `"preview_playlist_draft"` /
  `"persist_new_playlist_config"`.
- `getIntentEligibility` operation string `"get_intent_eligibility"` chosen
  (not specified by the plan) — mirrors the server-fn name, consistent with
  the other three call sites' snake_case-of-the-caller convention.
- `scheduler.test.ts` required updating beyond what the plan's task list
  mentions: it mocked `readBillingState` directly (`vi.mock("@/lib/domains/billing/queries", () => ({ readBillingState: ... }))`),
  which fully replaces the module's exports — once `scheduler.ts` imports
  `readBillingStateOrFreeTier` instead, that mock would leave the import
  undefined. Repointed the mock to `readBillingStateOrFreeTier` (resolving a
  plain `BillingState`, not a `Result`) and updated the three call sites
  accordingly. The "falls back to free/low priority when billing read fails"
  test no longer simulates a `Result.err` from `readBillingState` (that
  degrade path is now `readBillingStateOrFreeTier`'s own concern, covered by
  its unit tests in `queries.test.ts`) — it instead mocks
  `readBillingStateOrFreeTier` resolving `FREE_BILLING_STATE` directly, i.e.
  what the reader would return after an internal failure.
- `Object.freeze(FREE_BILLING_STATE)` needed an explicit `Object.freeze<BillingState>(...)`
  type argument — without it, `tsgo` widened `unlimitedAccess: { kind: "none" }`
  to `{ kind: string }` inside the frozen literal and typecheck failed on the
  `BillingState` annotation (a generic-call contextual-typing quirk, not a
  behavior change).
- CHUNK 1's new `intentEligibility.test.ts` intentionally does **not** import
  the CHUNK 2 `domains/billing/fixtures.ts` — it uses a local
  `makeBillingState` literal (same shape) so CHUNK 1 stays testable and
  committable independent of whether CHUNK 2 lands in the same PR.
- Fixture repoint site count came in higher than the plan's "~10" estimate
  once distinguished from DB-row mocks: grep for `plan: "free"` found ~30
  hits, but most are snake_case `account_billing` row literals for
  `readBillingState`/integration-test DB inserts, not `BillingState` object
  fixtures. Filtered to the 13 genuine camelCase `BillingState` construction
  sites (local `makeBillingState`/`billing`/`freeBillingState` factories or
  one-off literals) and left every snake_case DB-row mock alone — repointing
  those would conflate two different data shapes.
- Chunk-2 repoint list (13 sites, all now importing
  `@/lib/domains/billing/fixtures`):
  `features/settings/components/BillingSection.stories.tsx`,
  `features/liked-songs/components/UnlockConfirmDialog.stories.tsx`,
  `features/billing/components/PaywallCTA.stories.tsx` (kept its positional
  `makeFreeBillingState(creditBalance)` convenience wrapper, delegating to
  the shared fixture),
  `features/billing/__tests__/useCheckoutFlow.test.ts`,
  `features/billing/__tests__/checkout-fulfillment.test.ts`,
  `features/onboarding/__tests__/PlanSelectionStep.test.tsx`,
  `lib/domains/playlists/__tests__/draft-engine.test.ts` (only the
  `freeBillingState` const; left the unrelated `premiumBillingState` const
  alone — not a free-tier fixture),
  `lib/domains/library/accounts/__tests__/onboarding-allocation.test.ts`,
  `lib/domains/billing/__tests__/unlocks.test.ts`,
  `lib/workflows/enrichment-pipeline/__tests__/content-activation.test.ts`,
  `lib/workflows/enrichment-pipeline/__tests__/provider-disabled-validation.test.ts`
  (the `selfHostedBillingState` const only — the earlier snake_case
  `account_billing` row literal in the same file is a DB-row mock, untouched),
  `lib/workflows/library-processing/__tests__/scheduler.test.ts`,
  `lib/server/__tests__/onboarding.free-allocation.test.ts`.
  `unlocks.test.ts`'s local factory had different base defaults
  (`creditBalance: 10`, `queueBand: "standard"`) than the canonical free-tier
  base — verified every call site in that file always passes an explicit
  override for any field it asserts on, so repointing to the shared
  free-tier-based `makeBillingState` changes no test's observable behavior.
- Deliberately left `queries.test.ts`'s existing self-heal assertion
  (`result.value` `toEqual({ plan: "free", ... })` in the "returns free
  default and self-heals" test) as a literal rather than repointing it to
  `FREE_BILLING_STATE`/`makeBillingState()` — it pins production output
  shape, not a hand-authored fixture, so it's outside "repoint the fixture
  sites" scope.

## Workstream B — workflow extraction

- (none yet)

## Workstream C — commit-flow hook

- (none yet)
