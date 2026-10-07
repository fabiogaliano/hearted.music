# PR review: audit follow-up lanes (#34, #35, #36, #37)

Base `main@2fda60d3`. Lines cite the PR head unless marked `(main)`. No PR touches an off-limits file; none overlaps the worker-outcome worktree's ten uncommitted files.

Re-verified 2026-10-07 against the heads GitHub serves: #34 `b2fc0b29`, #35 `7169ddb3`, #36 `e37463bd`, #37 `358fcaca`. Every claim spot-checked below still holds on those heads; the only section that moved is #37 (three commits pushed since the first pass, see its **Status**). Short paths in this doc map to `src/lib/domains/taste/match-review-queue/` (deck), `src/lib/domains/enrichment/content-analysis/` (analysis), `src/lib/domains/billing/` and `src/lib/domains/taste/match-filters/` (billing lane).

## 1. Verdicts

| PR | Verdict | Reason |
|---|---|---|
| #36 analysis + prompts | merge after amendments | Valid and well placed; two unnamed edge divergences, a wrong `none` comment, and `decode*` breaks the `parse*` convention. |
| #34 query keys | merge after amendments | Valid; one isolated behavior commit; three factories moved without a lib consumer; lib-root placement undocumented. |
| #35 billing entitlement | merge after amendments | Valid; migration reuses the selector and is correctly granted; dead code left behind, names off the sibling pattern, one unnamed precedence change. |
| #37 deck entry | merge after amendments | Was "wait": the 6th commit is now pushed and the body is filled. Commits 6–8 sound; `DeckEntryError` is still not a `TaggedError`; module still holds two operations; one stray fixup commit. |

## 2. Per PR

### #36 `refactor/stored-analysis-and-prompts`

**Validity.** Commit 1 is structural except for two edge divergences its body omits: a blob satisfying both schemas now yields lyrical only (`read-schema.ts:104-111`) where main set both adapter slots (`song-detail-adapter.ts:44-47 (main)`; invisible because the panel already preferred lyrical, `SongDetailPanelSurface.tsx:243-251`); audio-feature fields now coerce per field with `.catch(null)` (`read-schema.ts:69-71`) where main passed them untyped. Cost shift: main parsed only the opened song (`LikedSongsPage.tsx:222`); the server now parses every unlocked row per page (`liked-songs.functions.ts:92-95`). The `none` doc says "missing rows, locked rows" (`read-schema.ts:80-81`) but those never reach it: `mapLikedSongPageRow` emits `null` for them (`liked-songs.functions.ts:91-100`). Pre-v17 rows rendering as instrumental pre-exists (same `safeParse` order on main, `song-detail-adapter.ts:40-42 (main)`). Commit 2 is 13 git renames with import rewrites only; `scripts/` is in tsconfig `include`, so the `@/` alias typechecks.

**Placement.** Right. `read-schema.ts` declares itself the client-safe schema module (`:51-53`) and enrichment writes the blob (`song-analysis.ts:527-538`). `decodeStoredAnalysis` passes the deletion test (envelope, ordered parse, coercion behind one argument).

**Naming.** `decodeStoredAnalysis` → `parseStoredAnalysis` (`parse*` exports across `src/lib`, zero other `decode*`). `none` → remove via the hoisted shape below, else `unreadable`. `StoredAnalysis`, `StoredAudioFeatures`, `getExperimentLyricalPrompt` (sibling `getLyricalPrompt`) keep.

**Smaller shape.** Hoist the orthogonal field: `{ audioFeatures; read: {kind:"lyrical"; value} | {kind:"instrumental"; value} | null }`. Touches `read-schema.ts`, `song-detail-adapter.ts`, two tests; deletes the triplicated `audioFeatures` and the misnamed variant.

**Tests.** Adapter assertions stay hand-written (`song-detail-adapter.test.ts:85-91,111,116`); the two new `read-schema.test.ts:78-103` cases each name a bug. Nothing lost. Biome on the moved dir: one import-sort error (`scripts/voice-audit/prompts/lyrical-v30.ts:1-2`, relative import sorted before the `@/` alias), plus `regen.ts:31`.

**Amendments.**
1. Commit 1 body: name lyrical-wins, per-field `.catch(null)`, and the per-row server parse.
2. Fix or remove `none` (`read-schema.ts:80-81`); prefer the hoisted shape.
3. Rename `decodeStoredAnalysis` → `parseStoredAnalysis`.
4. Sort imports in `lyrical-v30.ts` and `regen.ts`.

### #34 `refactor/client-query-keys`

**Validity.** All six commits match their subjects; only 629b6395 changes behavior and names both changes. Key values are byte-identical (`query-keys.ts:40-43`; `features/liked-songs/queries.ts:75`). `draftPreviewKeys.preview` lists the same seven fields in the same order (`query-keys.ts:113-133` vs `create/queries.ts:18-28 (main)`). `accountId` fed only `likedSongs.stats`, which the `likedSongs.all` prefix covers, so dropping it is sound. Only the layout had a `staleTime` (`route.tsx:108-112 (main)`), kept at `:109`. `ClaimHandleStep` flags were set and cleared together at every site (`:445-446,456-457,487-488,494-495 (main)`). `invalidateMatchSnapshotQueries` is `async` with five un-awaited calls (`query-keys.ts:156-189`) beside a sibling that awaits (`:145-149`).

**Placement.** `src/lib/query-keys.ts` is a lib-root file with no category in `module-boundaries.md`; the only precedent is `lib/platform/auth/query-keys.ts`. `lib/shared` would be wrong (which caches an entitlement dirties is a product rule). Defensible, undocumented. All three functions pass the deletion test; no pass-through.

**Naming.** `invalidateEntitlementQueries` is glossary-derived but the set excludes deck and summary keys (`query-keys.ts:146-148`) although the glossary defines entitlement as the gate on match-result visibility; keep, with a comment that the snapshot job refreshes those. `invalidateMatchSnapshotQueries` is accurate. `billingStateQueryOptions` matches 25 siblings.

**Smaller shape.** Move only the five families lib imports. `playlistKeys` and `draftPreviewKeys` have no lib consumer (`useActiveJobs.test.ts:103` only asserts absence); leaving them drops seven files and the structural `preview` parameter.

**Tests.** Dedupe test (`useAccountEvents.test.ts:189-208`) now counts billing-state calls; each processed frame still produces exactly one, so duplicate-cursor processing still yields two. Same bug pinned. New regression test (`:210-233`) fails against main as claimed. Other test changes are import lines.

**Amendments.**
1. One awaiting convention: `await Promise.all` in `invalidateMatchSnapshotQueries` (`query-keys.ts:156-189`) or make both `void`.
2. Comment on `invalidateEntitlementQueries` (`:134-139`) explaining the deck/summary exclusion.
3. Keep `playlistKeys` and `draftPreviewKeys` in their features, or state the all-keys-here rule in the header.
4. Add the file to `module-boundaries.md`, or move it under `lib/platform/`.

### #35 `refactor/billing-owns-entitlement`

**Validity.** f6d663f3 preserves order, strings and newness writes (`song-entitlement.ts:105-123` vs `content-activation.ts:145-179 (main)`); `none` still issues no RPC (`:121-122`). 22065ec8 has an unnamed precedence change: the validator now rejects before the ownership read (`playlists.functions.ts:485-512 (main)`), so bad filters on an unowned playlist give ZodError, not "Playlist not found". 7169ddb3 is safe: `persistNewPlaylistConfig` already validates (`playlist-draft.functions.ts:125-127`).

**Migration.** `get_match_filter_options` calls `select_entitled_data_enriched_liked_song_ids` (`migration:28`), no predicate copy; `SECURITY DEFINER`, `search_path = public` (`:17-24`); revokes from `PUBLIC, anon, authenticated` and grants `service_role` (`:90-94`), the harden-RPC pattern. Expand-only. jsonb is right here (three bounded aggregates, one round trip); #3 should still be set-returning. Partial `database.types.ts` entry (`:4177-4180`) is acceptable; fix generator drift separately. Follow-up: `get_account_release_year_counts` copies the same predicate and still feeds `taste-profile-queries.ts:218-224`.

**Placement.** Billing is a domain here; `applyEntitlementToSongs` hides two reads, a switch and two RPCs behind three args. Provenance read inside billing is right (`BillingState` is the client model, `state.ts:70`). Shared wrappers with `unlimited-subscription-gift.ts:123` / `unlocks.ts:198` would need flags: correctly not done. `buildLanguageOptions` imports only types (`languages.ts:14-17`).

**Naming.** See §3. Outcome kinds mix verbs: `activated_unlimited | unlocked_self_hosted | left_locked` (`song-entitlement.ts:10-13`). `languages.ts:9-11` header still names `orderLanguageOptions`; two orderers now differ on ties (`:166` vs `:234-236`).

**Smaller shape.** Commits 4–5 could be their own PR; otherwise right.

**Tests.** Harnesses run the validator (`playlists.functions.test.ts:36`), gaining `.max(10)` and `z.uuid()`. Rejections now assert the issue path (`:230`; `match-config.test.ts:168,336,350`) with the write still asserted uncalled: stronger. `playlist-draft.functions.test.ts:187` is a bare `toThrow()`: weaker than its siblings. Dedupe cases moved to `filter-options.integration.test.ts:171-195` with hand-computed values; CI runs integration tests and fails on skip (`main.yml:160-224`). Stage test 9→5 cases, the rest in `song-entitlement.test.ts:49-176`. `parseSaveMatchFilters` (`schemas.ts:136`) and `SUPPORTED_LANGUAGE_CODES` (`languages.ts:115`) are now test-only (only `__tests__/schemas.test.ts` and `__tests__/languages.test.ts` import them).

**Amendments.**
1. Delete `parseSaveMatchFilters` and `SUPPORTED_LANGUAGE_CODES` with their tests; fix `schemas.ts:4-10` header, which still describes two parsers.
2. Rename RPC to `get_account_match_filter_options` (migration, types entry, `filter-options-queries.ts:5,46`).
3. Outcome kinds → `unlocked_unlimited | unlocked_self_hosted | left_locked`; rename the function per §3.
4. 22065ec8 body: note validator-before-ownership precedence.
5. `playlist-draft.functions.test.ts:187`: assert the issue path.
6. `languages.ts:9-11`: fix header; align or document tie-break.

### #37 `refactor/deck-entry-in-domain`

**Status.** Origin now at 358fcaca, 8 commits. Since the first pass: 69775437 (`getOwnedQueueItem`) is pushed, so the old amendment 1 is done; the PR body is filled (old amendment 6 done) but lists seven commits and omits the eighth. Two commits are new to this review:

- 7bf1320a `one failure path for the four deck action dispatches`: server fn only (`match-deck.functions.ts`, +54/−79). `dispatchDeckAction` routes the action and the suggestion id to the atomic wrapper; the handler captures and throws once from a `DECK_ACTION_FAILURES` copy table. Sentry operation, extras and messages unchanged, as the body says. Structural, sound.
- 358fcaca `remove stale item field from fixture; drop no-op ?? undefined`: deletes an `item` block from a `deck-view.test.ts` fixture that no mapper read, and replaces `window ?? undefined` / `limit ?? undefined` with the bare value (`deck-read-queries.ts:212,254`). Both params are `number | undefined` (`:200,246`) and the generated args are `p_window?: number` / `p_limit?: number`, so the coercion was dead. True fixup; it belongs squashed into 91650d2 (fixture) and cf98f0fd (coercion), not left as a trailing commit with a `Co-authored-by: … <undefined@users.noreply.github.com>` trailer.

**Validity.** 5142e1e4: three enums replaced; narrowers keep their failure modes (`queries.ts:49-52` throws, `match-deck.functions.ts:82-83` null, `preferences-queries.ts:366-369` default). cf98f0fd: `fromSupabaseRpc` now passes `data` through (`supabase.ts:114`); callers are `queries.ts:596` and the two deck RPCs, none relied on `[]`. Unknown statuses still fail open via `catchAll()` (`deck-read-queries.ts:109-113`, captured at `:215-235`). Unnamed in the commit body (the PR body does name it): a drifted `active` payload now runs the miss build, a write, where main rendered defaults (`match-deck.functions.ts:490-511 (main)`). d0f59ba2: `"album"` orientation now decodes as unrecognized instead of a song deck (`:471-472 (main)`); unreachable under the CHECK, pinned by `deck-read-queries.test.ts:59-96`. 91650d22: pure move; no server file imports another for domain types afterwards. b17a9043: `deck-entry.ts:94-185` is the old resolver with throws → `Result.err({step, cause})`; Sentry operation names reproduced (`match-deck.functions.ts:68-87`). But 564 lines = entry + the miss path verbatim (`:208-410`) + the card cold path moved from the server fn (`:412-564`): two operations moved. 69775437: `getOwnedQueueItem` replaces the three owned-item reads; each caller keeps its own handling and Sentry operation; the cold path reads orientation from the DTO instead of narrowing the raw column (CHECK keeps them equal). Server file 1048 → 321.

**Placement.** `deck-view.ts` passes (contract types + mappers hiding the status switch). `MatchOrientationSchema` in `types.ts:21-22` right. `deck-entry.ts` is misnamed for its contents (header admits both, `:1-6`). `DeckEntryError` is a plain interface (`deck-entry.ts:65-72`); every other domain error is a `TaggedError` (`song-matching/types.ts`, `lyrics/providers/*`).

**Naming.** `entry: "active" | "promoted" | "no_snapshot" | "promotion_incomplete"` matches the analysis doc and the existing event vocabulary. `DeckRead = "entry" | "after_action"` (`deck-entry.ts:62`) replaced the proposed `knownVisibilityConfigHash`, rightly (after-action probes with a null hash); rename `DeckReadKind`. `DeckCardRead.materialized` is set whenever the cold path ran (`:74-77,559-561`): `coldPath`.

**Smaller shape.** Two PRs: commits 1–3 (schemas, mergeable now) and 4–8 (moves). Leave `resolveDeckCard`/`materializeOnDemand` in the server fn; `deck-entry.ts` becomes entry + miss path (~400 lines) and `DeckCardRead` disappears.

**Tests.** `supabase.test.ts:28-37` null case flipped to `rpc_shape_mismatch`. Nine mapper tests moved verbatim to `deck-view.test.ts` (they pin the status union, keep). Miss-path → `deck-entry.test.ts`: all 11 cases survive through `resolveMatchDeck`; `nowMs` was pinned on main and is now read back from the mock (`deck-entry.test.ts:89-92`). Two server-fn cases moved to entry-event tests. 69775437 adds an integration case pinning that the owned read never returns another account's item.

**Amendments.**
1. `DeckEntryError` → `TaggedError("DeckEntryError")`.
2. Move `resolveDeckCard` back to the server fn, or rename the module for both reads.
3. cf98f0fd body: drifted `active` now triggers a proposal build (the PR body says it; the commit does not).
4. `deck-entry.test.ts`: `vi.setSystemTime` instead of reading `nowMs` from the mock.
5. Squash 358fcaca into the commits it fixes; drop the malformed co-author trailer.
6. PR body: add commit 7 (`one failure path …`) to the list, or fold it in after the squash.

## 3. Naming decisions

1. **`applyEntitlementToSongs`** → `unlockSongsUnderEntitlement` (recommended: glossary "unlock / entitlement"; siblings `requestSongUnlock`, `grantFreeAllocation`; it writes `account_song_unlock` rows) · keep `apply` · `activateEntitledSongs` (reject: activation is an enrichment step).
2. **`get_match_filter_options`** → `get_account_match_filter_options` (recommended: five `get_account_*` siblings) · keep. TS `readMatchFilterOptions`: keep (`fromSupabaseRpc` reads in billing and match-review-queue use `read*`).
3. **`decodeStoredAnalysis`** → `parseStoredAnalysis` (recommended: `parse*` is the only verb for this in `src/lib`) · keep. **`none`** → hoisted shape with `read: null` (recommended) · `unreadable` · keep.
4. **`invalidateEntitlementQueries`** keep with comment (recommended) · `invalidateBillingQueries` (truer to the set, loses the glossary word).
5. **`DeckEntry`** keep; `DeckRead` → `DeckReadKind`; `materialized` → `coldPath`.
6. **`buildLanguageOptions`** keep; **`getExperimentLyricalPrompt`** keep.

Synonym pairs left: eligible/visible/undecided (untouched); orientation/mode (`deck-view.ts:90,104` uses `mode` inside the domain); activate/unlock/apply/grant; get/read/fetch (three verbs across 26 domain reads); options/aggregates/counts; analysis/content/read (`onboarding-session.ts:6`); refresh/invalidate; card/item; deck/queue/session.

## 4. Merge plan

Order #36 → #34 → #35 → #37, re-verified in a scratch worktree against the current heads. The first three merge clean. #37 at 358fcaca still conflicts in the same three files, all import blocks: `QueueMatchSession.tsx`, `mutations.ts`, `__tests__/mutations.test.ts` (#34 re-points key imports to `@/lib/query-keys`; #37 re-points type imports to `deck-view.ts` and, in `mutations.ts`, drops the `SubmitMatchDeckActionResult` import #34 keeps). Each resolves by keeping both sides' import lines. After hand resolution on the first pass: typecheck showed only main's five baseline errors (`tunekit` not installed locally, `DevWorkflowPanel.tsx`), Biome clean, 49 tests across the four touched suites passed. **#37 rebases on #34**; no other pair overlaps. No two PRs change the same exported symbol; the only shared test file is `mutations.test.ts` (#34/#37, imports only).

#3 `loadVisibilityInputs`: unconstrained. #35 leaves `readEntitledDataEnrichedSongIds` and every targeted `.in()` site; #37 leaves `queries.ts:409-423,897 (main)` untouched. `DeckJobSpec`: `deck-jobs.ts:240` unchanged.

## 5. What the run got wrong

- **Lane scope set by an invariant, not a consumer.** #34 moved eight factories where lib needed five; #37 folded the card cold path in with the miss path. Reading the consumers first fixes the boundary.
- **Names picked per lane, not by sibling scan.** `decode*` vs `parse*`, `get_match_*` vs `get_account_*`, plain interface vs `TaggedError`, mixed outcome verbs. One grep each would have settled them.
- **Behavior deltas found after the split.** Every lane has one or two unnamed changes (error precedence, lyrical-wins, `.catch(null)`, miss-build-on-drift) because commits were cut before the diff was read against main.
- **Fixups pushed as commits.** #37's 358fcaca is review fallout committed on top instead of squashed into the commit it corrects; the PR body then drifts from the log.
