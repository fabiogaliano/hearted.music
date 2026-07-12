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

- (none yet)

## Workstream B — workflow extraction

- (none yet)

## Workstream C — commit-flow hook

- (none yet)
