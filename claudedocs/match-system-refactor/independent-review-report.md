# Match System Refactor — Independent End-to-End Review

Reviewer pass over `feat/match-system-refactor` (`a63bba8c..HEAD`, 41 commits). Read-only; no code changed.

## Verdict

**Correct, complete, and safe to merge.** No HIGH (correctness/security) findings. The SQL/RPC layer — the least unit-testable and highest-risk surface — is the strongest part of the work: every SECURITY DEFINER function pins `search_path`, revokes from PUBLIC/anon/authenticated, grants only to `service_role`, takes a `FOR UPDATE` row lock, sources ranks from captured pairs, and is orientation-aware (the MSR-06 `v_item.song_id` null-guard defect is genuinely fixed). The end-to-end playlist path (the known plan gap) is wired present→render→add/dismiss/finish, and the three "MSR review fix" migrations (Findings 1/2/5) are real, sound bug fixes discovered during the build.

One MEDIUM design observation worth confirming with product (read-time filters vs. queue membership) and a handful of LOW cleanups. None block merge.

## Verification (observed)

| Check | Result |
|---|---|
| `bun run typecheck` (`tsgo --noEmit`) | **clean, exit 0** |
| `bun run test` | **270 passed / 1 skipped files; 3142 passed, 8 skipped, 12 todo; 0 failures** |
| `bunx biome check` (refactor dirs) | **0 errors, 0 warnings, 6 `useLiteralKeys` infos** |

Notes:
- Test counts are ~19 passing / 1 file below the handoff baseline (272 files / 3161 passed). The delta is **1 skipped file**, not a failure — almost certainly an integration suite gated on a stopped local service (`supabase status` shows `imgproxy`/`edge-runtime`/`pooler` stopped; core DB/API up). Zero failures.
- Biome infos: 4 in `capture-visible-pairs.ts` (documented) **+ 2 in `match-search.ts:24,46`** (not mentioned in handoff). All cosmetic bracket-access on dynamically-typed objects; biome marks the fixes "unsafe."

## Per-area verdicts

| Area | Verdict |
|---|---|
| 1. Plan adherence / terminology | PASS — canonical names (orientation, fitScore, modelRank/visibleRank, strictnessScore, discriminated `MatchReviewItemRead`) used consistently; deviation log is honest and complete. |
| 2. SQL/RPC correctness | PASS — hardening, locking, idempotency, captured-pair ranks, orientation-aware entitlement all correct. |
| 3. Invariants (strictnessScore / no any,!,unsafe-as / unions / no barrels) | PASS — `strictnessScore = fused_score ?? score` used everywhere for gate+display+ordering; no `any`, no non-null `!`, no barrels; all `as` are DB/JSON/enum boundary casts. |
| 4. Visible-list contract | PASS (with LOW note) — single derivation source; AND across filter types, OR within languages; missing metadata fails filters for both orientations; DB error → retryable, never a silent hide. |
| 5. UI / route | PASS — mode normalization/redirect, a11y toggle (`role="group"` + `aria-pressed`, keyboard-operable), song-mode visual equivalence preserved, orientation-aware copy/states. |
| 6. End-to-end playlist path (MSR-39 + Finding 1) | PASS — derive→insert→present→render→add/dismiss/finish all wired; song mode not regressed. |

## Findings (prioritized)

### MEDIUM

**M1 — Hard filters are applied at presentation but not at queue derivation (asymmetric with strictness).**
`src/lib/domains/taste/match-review-queue/service.ts` — `deriveUndecidedSongsForQueue`/`deriveUndecidedPlaylistsForQueue` (≈73–115, 174–204) and `appendSnapshotDelta` playlist arm (≈682–733) gate subjects on `strictnessScore(mr) >= minScore` + undecided + entitlement, but never call `passesAllMatchFilters`. `fetchTargetPlaylistFilters` is used only to compute `readTimeFiltersHash` (idempotency key), not to filter subjects.

Consequence: a subject whose every above-strictness, undecided suggestion is hidden by an active hard filter (language/release-year/liked-at/vocal-gender) is still enqueued and then presents as an "unavailable / No matches visible under your current settings" card. The visibility-hash mechanism handles *loosening* (new subjects appended) but not *tightening* (stale subjects are not pruned), and the initial enqueue over-includes filter-hidden subjects. The "loosen strictness" empty state (`hiddenReviewItemCount`) counts strictness-hidden subjects only, never filter-hidden ones.

This is defensible as a deliberate "filter-agnostic queue, purely presentational read-time filters" design (loosening a filter instantly reveals suggestions on an already-queued card with no re-derivation). But strictness *is* applied at derivation while hard filters are not — that inconsistency looks unintended given they're conceptually peers.

Suggested fix: either apply `passesAllMatchFilters` during derivation for parity with strictness (and feed filter-hidden subjects into `hiddenReviewItemCount`), or explicitly document and accept the empty-card skip behavior. Confirm product intent before changing — present-time handling is graceful, so this is quality, not corruption.

### LOW

**L1 — Orchestrator reranker construction is inconsistently guarded.**
`src/lib/workflows/match-snapshot-refresh/orchestrator.ts:570` — `const effectiveReranker = rerankerService ?? new RerankerService();` runs uncaught, while the identical construction at lines 269–272 is wrapped in `try/catch`. The line-566 comment claims the constructor "cannot throw," but the wrapped sibling implies otherwise. If construction *can* fail, line 570 crashes the workflow instead of degrading to `fused_fallback` — exactly the case the try/catch at 269 exists to handle. This is the MSR-17 follow-up the deviation log already flagged as non-blocking. Fix: drop the now-redundant try/catch at 269 (if it truly can't throw) or wrap line 570 to match.

**L2 — `deriveVisibleSuggestions` filter guard contradicts its own docstring.**
`src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts:164–172` — applies `passesAllMatchFilters` only when `songMeta !== null`, but `MatchPairInput.songMeta` is typed `SongFilterMetadata | null` and the docstring says "Missing metadata fails any active filter." Both production call sites normalize absent metadata to an *all-null object* (not `null`), so the contract holds in practice — but a future caller passing `songMeta: null` with active filters would get a silent pass-through. Fix: treat null/undefined `songMeta` as fail-filters inside the pure function, or narrow the type to non-null.

**L3 — Duplicate exported `MatchReviewSummaryResult`.**
`src/lib/domains/taste/match-review-queue/types.ts:159` and `src/lib/server/match-review-queue.functions.ts:1164` both export an interface of this name. The MSR-01 deviation said this duplicate was temporary "until a later story migrates callers"; the consolidation never happened. Cleanup — risk of confusion / silent divergence between the two shapes.

**L4 — Cosmetic UI leftovers.** (a) `MatchesSectionProps.isLastSong` was not renamed to `isLastItem` (MSR-34 renamed only at the session boundary; the session bridges it correctly via `isLastSong={isLastItem}`). (b) `CompletionScreen` renders `<img src={item.albumArtUrl ?? undefined}>`; a playlist-mode recap row with a null `imageUrl` yields a broken-image icon (and playlist rows use `artist: ""`). Pre-existing pattern; minor polish.

**L5 — `match-search.ts` biome infos undocumented.** Two `useLiteralKeys` infos at lines 24 and 46 beyond the documented 4 in `capture-visible-pairs.ts`. Cosmetic.

### INFORMATIONAL (acceptable as-is)

- `getMatchReviewItem` returns `unavailable` for playlist items (warming prefetch only). The authoritative render always uses `presentMatchReviewItemQueryOptions`, so this is harmless — but the next-card warming prefetch (`matchReviewItemQueryOptions`) for playlist items is wasted work it can never satisfy. Acceptable; a future tidy-up could skip warming in playlist mode.
- `analysis as MatchingSong["analysis"]` (`match-review-queue.functions.ts:747`) and `effectiveConfig as unknown as Record<string,unknown>` (`song-matching/cache.ts:77`) are JSON-serialization boundary casts, not compiler-silencing hacks.

## Deviation-log assessment

The deviation log is accurate and does not hide a defect. Spot-checks:
- **MSR-06 null-guard defect** (logged as deferred to MSR-26–28): genuinely fixed — final add/dismiss/finish RPCs branch on orientation and never read a NULL `song_id` for playlist subjects.
- **MSR-35 "subagent accidentally dropped `match_snapshot_superseded` from the union; restored manually":** verified present and fully wired (types union, debounce map = 0 ms, reconciler case, `MatchSnapshotChanges.superseded` constructor). No defect.
- **PLAN-GAP / MSR-39:** the orchestrator-added story is real and sufficient — playlist render path exists and is reachable. The separately-discovered **Finding 1** (`insert_queue_playlist_items`, migration `20260627000000`) closes the *other* half: without it, playlist sessions recorded snapshots as applied with zero items (permanently empty mode). That insert RPC is now wired into `appendSnapshotDelta` (service.ts:775).
- **MSR-17 follow-up:** honestly recorded; still open (see L1).

## Why this is mergeable

The captured-visible-pair model makes mutations deterministic: `presentMatchReviewItem` derives once (single source: `visible-suggestion-list.ts`), captures atomically (first-write-wins), and add/dismiss/finish read ranks from the captured rows under a row lock — so concurrent tabs, retries, and snapshot churn cannot corrupt decisions. The two latest "review fix" migrations close the only end-to-end gaps (empty-capture stuck card; ambiguous add target). Tests (3142) pass, typecheck is clean, biome is error-free. M1 is the only thing I'd want a product decision on, and it degrades gracefully today.
