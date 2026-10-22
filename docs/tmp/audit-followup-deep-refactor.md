# Audit follow-up: do the seven open findings share a root cause?

Base: `main` at `2fda60d3` (typecheck clean); line numbers are from this tree. Re-measured: the "15 `.in()` sites" are 5 DB-derived plus 6 literal status lists; the "3 casts" are 2; the "13 feature imports" are 5 in production plus 8 in tests; #13's schema copy was already deleted in `0fbbcaaf`.

## 1. Verdict

A mix. One deep module is warranted: a single loader for the visibility inputs behind `visibility-policy.ts` (#3), which deletes all five DB-derived `.in()` sites and the duplicated readers. One system convention is missing, not a module: every jsonb shape gets one owning Zod schema that all readers decode through (#15 and the residue of #13). The rest (#11, #16, #6, #14) are independent placement moves that share no mechanism and should run as local cleanups in parallel.

## 2. Root causes

**RC1. The visibility policy is pure, but its inputs have no owner.** `passesVisibilityPolicyForPair` (`match-review-queue/visibility-policy.ts:90`) is one module, yet three async assemblers each gather pairs, decisions, entitlement, ownership, song metadata and playlist filters before calling it: `service.ts:135-188` and `:233-290`, `eligible-subjects.ts:82-145`, `visible-suggestion-list.ts:372-535`. Each derives song and playlist ids from the pairs and feeds them back through chunked `.in()` at `filter-metadata-queries.ts:103,111,149`, `queries.ts:423` and `visible-suggestion-list.ts:304`. The assemblers already disagree: subject derivation reads filters only for `is_target` playlists (`queries.ts:897`), the card path reads filters for any playlist in the pairs (`filter-metadata-queries.ts:149`); entitlement is read with no id list in `service.ts:156` and with `songIds` in `eligible-subjects.ts:121`; `fetchOwnedPlaylistIds` exists twice, byte-identical (`queries.ts:409`, `visible-suggestion-list.ts:290`). Explains #3 entirely. It does not explain #11 or the deck casts in #15: those read the materialized session (`match_review_item_visible_pair` via `read_match_deck_card`), a different subject.

**RC2. Jsonb shapes have no owning schema.** The two deck RPCs are bare casts (`deck-read-queries.ts:212,250`) with only `status` checked. The ten `Json`-returning RPCs use four decoding styles: Zod (`extension-sync-jobs.ts:56`), hand decoders (`unlocks.ts:52`, `liked-song-access-grant.ts:64`), `fromSupabaseRpc` once (`queries.ts:594`), bare casts. "song | playlist" is defined thirteen times: three Zod enums (`match-deck.functions.ts:139`, `match-review-queue.functions.ts:23`, `settings.functions.ts:110`) and five narrowers that disagree on failure (throw at `queries.ts:49`, null at `match-deck.functions.ts:199`, silent `"song"` at `:471`). The deck-job payload is written untyped at `proposal-rebuild.ts:25` and `poll-match-deck-jobs.ts:211`, decoded by hand at `poll-match-deck-jobs.ts:61`. `song_analysis.analysis` is cast to a pre-v17 type at `liked-songs.functions.ts:95` and `onboarding-session.ts:194`, then parsed twice on the client. #13's residue shares the cause: `matchFilters: z.unknown()` at `playlists.functions.ts:486`, parsed in the handler at `:536`; `publish.ts:125` re-parses typed filters. 61 of 68 server fns are clean; the six inline enums exist because domains export TS types without schemas.

**RC3. Four modules filed one layer off, with nothing in common.** Deck read model in `lib/server` (#11: `match-deck.functions.ts` 1,048 lines, `resolveMatchDeckView` at `:551` with opposite flags at `:884` and `:1028`, owned-item reads at `:708`, `:853`, `match-review-queue.functions.ts:135`). Query keys in features consumed by `lib/hooks` (#16: `useAccountEvents.ts:3-6`, `useActiveJobs.ts:3`). Billing writes in a workflow stage (#6: `content-activation.ts:22,60,85`, the only workflow file touching billing tables). Experiment prompts in `src` (#14: `registry.ts:47` pins `"17"`; v19–v30 reachable only from `scripts/voice-audit`).

## 3. Proposed modules

### A. `match-review-queue/visibility-inputs.ts` (RC1, #3) — size L, openspec yes

```ts
/** Everything the visibility policy needs about one account's match pairs, joined in SQL so no DB-derived id re-enters a query. */
export function loadVisibilityInputs(
  supabase: SupabaseClient,
  scope: { accountId: string; snapshotId: string } &
    ({ kind: "account" } | { kind: "song"; songId: string } | { kind: "playlist"; playlistId: string }),
): Promise<Result<VisibilityInputs, DbError>>;

export interface VisibilityInputs {
  pairs: ReadonlyArray<{ songId; playlistId; score; fusedScore: number | null; rank: number | null;
                         decided: boolean; playlistOwned: boolean; songEntitled: boolean; isNew: boolean }>;
  songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
  filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1 | null>;
  minScore: number;
}
```

One set-returning RPC paged with `.range()` like `readEntitledDataEnrichedSongIds`, decoded through `fromSupabaseRpc`. Filters stay jsonb, evaluated by the pure policy; the RPC only joins. Doors: `getSongSuggestions` (`matching.functions.ts:191`), the summary server fn, the proposal builder via worker and miss path, `captureAheadForSession`, and `hasFirstVisibleReviewSubject` (signature unchanged, so the in-flight callers at `active-jobs.ts:46` and `scheduler.ts:170` do not move). Deletes: `filter-metadata-queries.ts` (163 lines), both `fetchOwnedPlaylistIds`, `fetchTargetPlaylistFilters`, `fetchEntitledSongIds`, `checkPlaylistOwned`, the entitlement RPC call at `visible-suggestion-list.ts:248`, three `Promise.all` fan-outs, and the dead `minScoreOverride` (`service.ts:138,236`). Principle: no DB-derived `.in()`; the deletion test passes because a one-argument scope hides a six-table join. Tests: `filter-metadata-queries.test.ts` and the mocked-query halves of `visible-suggestion-list.test.ts` (from `:695`) and `service.test.ts` become redundant; one new `visibility-inputs.integration.test.ts` is needed; pure tests stay.

### B. `match-review-queue/deck-entry.ts` + `deck-view.ts` (RC3, #11) — size M, openspec no

```ts
/** Start or resume the deck for one orientation: hash → probe → miss build → promote, one Result. */
export function resolveDeckEntry(
  accountId: string, orientation: MatchOrientation, options: { reuseHash?: string },
): Promise<Result<{ view: MatchDeckView; entry: "active" | "promoted" | "no_snapshot" | "promotion_incomplete" }, DbError>>;
```

Both booleans collapse into `entry`; the server fn emits hit/miss from it. Folds in `match-deck-miss-path.ts` (229 lines) and one `getOwnedQueueItem` in `queries.ts` replacing three reads. RC2's deck pieces ride along because they touch the same files: `StartOrResumeMatchDeckSchema` and `ReadMatchDeckCardSchema` in `deck-read-queries.ts` decoded through `fromSupabaseRpc` (drop its `?? []` default at `supabase.ts:112`; one caller), and `MatchOrientationSchema` in `types.ts` replacing the three enums. Doors: three deck server fns. Principle: domain orchestration lives in domains; one union over co-occurring booleans. Tests: `match-deck-miss-path.test.ts` becomes `deck-entry.test.ts`; mapper tests move with the mappers.

### C. `src/lib/query-keys.ts` + named invalidation sets (RC3, #16) — size M, openspec no

```ts
/** Every client cache key, dependency-free so lib hooks and features both import downward. */
export const billingKeys, dashboardKeys, likedSongsKeys, matchDeckKeys, matchReviewSummaryKeys;
/** The one list of caches an entitlement change invalidates. */
export function invalidateEntitlementQueries(qc: QueryClient, accountId: string): Promise<void>;
export function billingStateQueryOptions(): ReturnType<typeof queryOptions>;
```

The graph settles direction: the keys depend only on lib types, the hooks serve four features, and `lib/platform/auth/query-keys.ts` already does this. Deletes the four differing entitlement copies (`usePostPurchaseReturn.ts:48-53,60-68`; `useSongUnlock.ts:63-69`, which misses dashboard; `useAccountEvents.ts:252`, billing only), three hand-declared billing queries with three staleTimes, dead `matchReviewKeys`, and one of the two flags at `ClaimHandleStep.tsx:128,132`. The SSE path adopting the full set is a behavior change; own commit. Tests: `useAccountEvents.test.ts:203,244` assert the named set.

### D. `domains/billing/content-activation.ts` (RC3, #6) — size S, openspec no

```ts
/** Activate content for every entitlement kind: unlimited subscription, self-hosted, or none. Owns the two billing RPCs. */
export function activateEntitledSongs(supabase, accountId: string, songIds: string[]): Promise<Result<ActivationOutcome, DbError>>;
```

Takes the `unlimitedAccess.kind` switch (`content-activation.ts:165-179`), the `account_billing` read (`:22`) and both RPCs (`:60,85`), sharing them with `unlimited-subscription-gift.ts:124` and `unlocks.ts:198`. One-off confirmed: every other workflow uses a `domains/billing` export. Alongside: the filter-options `.in()`s (`filter-options-queries.ts:54,111,188`) become one aggregate RPC over the entitled set, and the language merge in `playlists.functions.ts` (~`:842-916`) becomes a pure function in `match-filters/languages.ts`. Tests: `content-activation.test.ts` drops its `account_billing` mock; the switch gets a billing unit test.

### E. Jsonb schema convention (RC2, #15, #13 residue) — size S, openspec no

Placements, not a module. (1) `AnalysisRead = { kind: "lyrical" } | { kind: "instrumental" } | { kind: "none" }` decoded server-side from `read-schema.ts`, deleting `AnalysisContent` and the adapter's double parse. (2) `MatchFiltersSaveSchema` in `savePlaylistMatchConfig`'s validator; delete the re-parse at `publish.ts:125`. (3) Deck RPC and orientation schemas, in B. (4) `DeckJobSpec` keyed by `kind`, typed on `EnqueueDeckJobInput.payload` (`deck-jobs.ts:240`) so writer and reader share it; waits (§5).

## 4. What stays local

- **#14** (S): move `lyrical-v17-regrouped` and v19–v30 to `scripts/voice-audit/prompts/` with a script-side registry; shrink `LYRICAL_PROMPTS` to `"17"`; drop unused `listLyricalVersions`; repoint `regen.ts`, `verify-variants.ts`, `db-lever-compare.ts`.
- **#13 edge residue** and **#6 filter options**: inside E(2) and D.
- Unrelated bugs seen, not in scope: `matching.functions.ts:222` reads `playlist` by id with no `account_id` filter and drops the error; `getMatchResults` (`song-matching/queries.ts:112`) is unpaginated; stale comments at `match-deck.functions.ts:14-16,132,246`.

## 5. Order and parallelism

| Lane | Files | Conflicts |
|---|---|---|
| A (#3) | `match-review-queue/{service,eligible-subjects,visible-suggestion-list,queries,filter-metadata-queries,visibility-inputs}.ts`, migration, `matching.functions.ts` | B (`queries.ts`, different regions) |
| B (#11 + E3) | `lib/server/match-deck*.ts`, `match-review-queue.functions.ts`, `settings.functions.ts`, `match-review-queue/{deck-entry,deck-view,deck-read-queries,types,queries}.ts`, `supabase.ts` | A (`queries.ts`); E4 later |
| C (#16) | `lib/query-keys.ts`, `lib/hooks/*`, five `features/*/queries.ts`, two billing hooks, `ClaimHandleStep.tsx` | none |
| D (#6) | `content-activation.ts`, `domains/billing/*`, `filter-options-queries.ts`, `playlists.functions.ts`, `languages.ts`, migration | E2 (`playlists.functions.ts`): run E2 inside D |
| E1 (#15 analysis) | `liked-songs.functions.ts`, `onboarding-session.ts`, `analysis-content.ts`, `song-detail-adapter.ts`, `features/liked-songs/types.ts` | none |
| #14 | `prompts/registry.ts`, 13 prompt files, three scripts | none |

C, D(+E2), E1 and #14 can start now in separate worktrees. A and B both edit `match-review-queue/queries.ts`; run B first (smaller), then A. **E4 waits** for the worker-outcome branch: its writer at `poll-match-deck-jobs.ts:211` and reader at `:61` are `src/worker/*`. Nothing else touches the off-limits files.

## 6. Open decisions

1. **A's RPC shape**: set-returning rows paged with `.range()` (recommended; immune to the PostgREST row cap) vs one JSONB blob.
2. **A's filter source**: join filters for the playlists that appear in pairs (recommended; makes the `is_target` divergence vanish) vs keep `is_target`-only. Confirm pairs exist only for target playlists.
3. **A goes through openspec**: yes (recommended; L with a migration and a semantics unification) vs treat as structural.
4. **SSE `billing_state_changed` adopts the full entitlement set**: yes, separate commit (recommended) vs keep billing-only.
5. **#14 lint coverage**: extend Biome `files.includes` to `scripts/` (recommended, small) vs accept the moved files unlinted.
6. **E4 ownership**: a follow-up PR after the worker branch merges (recommended) vs add to that branch's owner list.

## 7. Where the sister standards didn't fit

- **"One operation serves every door"**: control-panel reaches none of this code, scripts reach one hash helper. Door counts are two or three, not four.
- **Deep module vs "no abstraction before the third occurrence"**: a generic jsonb decoder would be premature; CLAUDE.md wins, so E is per-shape schemas plus the existing `fromSupabaseRpc`.
- **Functional core**: already satisfied. The defect is in the shell's assembly, so purity is not the lever.
- **Illegal states on RPC status**: deck reads fail open on an unknown status and report to Sentry; "define errors out of existence" supports keeping that.
- **Tests at the server-fn seam**: the server fns here are three-line boundaries; A's load-bearing test sits at the domain loader against real Postgres.
