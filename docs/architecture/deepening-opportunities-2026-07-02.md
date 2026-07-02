# Deepening Opportunities — 2026-07-02

Architecture review focused on **deepening**: turning shallow modules (interface nearly as complex as the implementation) into deep ones (a lot of behaviour behind a small interface). Candidates are ordered by how much locality and leverage they buy. Vocabulary: *module*, *interface*, *seam*, *adapter*, *deletion test* — a module passes the deletion test when removing it makes its complexity reappear across N callers; it fails when the complexity simply vanishes (pass-through).

The codebase already contains the target patterns — `shared/spotify-command-protocol.ts` (deep, versioned, runtime-validated seam), `enrichment-pipeline/stages/` (orchestrator decomposed into testable stages), `features/matching/queue-helpers.ts` (pure, fully tested derivations). Most candidates below apply an existing in-repo pattern to a place that missed it.

> **Live bug found during this review:** the reachable `TRIGGER_SYNC` handler in `extensions/src/background/service-worker.ts` (~line 898–911) returns `{ ok: true, ...result }` even when `result.kind === "backend-failure"`, so `useDashboardSync` (`src/features/dashboard/hooks/useDashboardSync.ts:177-227`) silently treats failed syncs as successes. The handler that honors the `ExtensionSyncRequestResult` contract (`onMessage` switch, ~line 1196–1227) is dead code — nothing sends an internal `TRIGGER_SYNC`. This is a symptom of candidate 1.

---

## 1. Extension message dispatch — one typed dispatcher instead of two shallow ones

**Files**
- `extensions/src/background/service-worker.ts` (1345 lines) — two independent dispatchers: `handleExternalCommand` (~860–1018, typed via ad-hoc structural shape with `[key: string]: unknown`) and the `browser.runtime.onMessage` switch (~1066–1255, typed against the real union)
- `extensions/src/shared/types.ts:37-105` — `ExtensionMessage` / `ExternalMessage` unions
- `src/lib/extension/detect.ts` — constructs messages as untyped literals (`{ type: "PING" }`)
- `shared/extension-sync-contract.ts` — the result contract only the unreachable path honors

**Problem.** The control-message vocabulary (`PING`, `CONNECT`, `TRIGGER_SYNC`, `GET_STATUS`, …) is declared once but dispatched through two separately-typed handlers, and the app side doesn't import the types at all. `TRIGGER_SYNC` is implemented twice: the reachable path violates the result contract (the `ok: true` bug above), the contract-honoring path is unreachable. The seam exists on paper (`shared/`) but the dispatch interface is too shallow for the compiler to enforce anything. The sibling Spotify command protocol is the in-repo counterexample: small vocabulary, validated both directions, one exhaustive dispatcher (`command-handler.ts`), thoroughly tested (`command-routing.test.ts`).

**Solution.** Move the message unions into `shared/`, collapse both dispatchers into one pure, injectable `dispatchExtensionMessage(message, deps)` module with an exhaustive switch (same shape as `command-handler.ts`), and have `detect.ts` construct messages from the shared types.

**Benefits.** One implementation per message — the sync-failure contract has a single place to be right (locality). The dispatcher becomes unit-testable the way `handleSpotifyCommand` already is; a test asserting `ok === false` on backend failure would have caught the live bug. Also carves the most dangerous chunk out of the 1345-line service worker.

## 2. Match review session — pull the mutation core out of the 1260-line route

**Files**
- `src/routes/_authenticated/match.tsx` (1260 lines — largest route in the app; next biggest is 433). Tree: `MatchPage → QueueMatchPage → QueueMatchContent (~230 lines) → QueueCardContent (~560 lines)`
- `QueueCardContentProps` (lines 665–701): 20 fields, 6 of them raw `React.Dispatch<SetStateAction>` setters

**Problem.** The match review session — current item, locally resolved items, session stats, add/dismiss/skip — lives as inline closures in the route. `handleAdd` (lines 1013–1122) duplicates ~50 lines across its song-mode and playlist-mode branches (Spotify write, server mutation, analytics, stats). The parent hands the child unrestricted setters instead of a constrained contract, so the interface is as complex as the implementation. Test coverage: `match.test.ts` covers only loader mode-redirects; none of the mutation behavior is tested. `queue-helpers.ts` (201 lines, pure, fully tested) shows the extraction pattern was applied to the *derivations* but not the *mutations* — where the real bugs live.

**Solution.** A `useMatchReviewSession(itemIds, mode, accountId)` hook (or reducer) owning session state and exposing a small, mode-unified interface — roughly `resolve(action: "add" | "dismiss" | "finish", payload)` plus navigation — with song/playlist branching collapsed behind it.

**Benefits.** The interface becomes the test surface: add/dismiss/finish become plain input→output tests with no rendering. The 20-prop interface shrinks to a handful. The duplicated mode branches disappear, so the next mutation (e.g. undo) is written once.

## 3. One Match Review Column instead of structural twins

**Files**
- `src/features/matching/components/MatchesSection.tsx` (360 lines) — song-mode column
- `src/features/matching/components/SongSuggestionsSection.tsx` (479 lines) — playlist-mode column

**Problem.** The review column concept is implemented twice. `AnimatedMatchesPanel` (243–284) and `AnimatedSuggestionsPanel` (367–408) are identical framer-motion wrappers modulo a prop name; `MatchesControls` (291–360) and `SuggestionsControls` (413–479) differ only in a count prop and the string `"Skip Song"` vs `"Skip Playlist"`. The single-active-preview behavior exists twice in different shapes: `MatchRow` uses the shared `usePlaylistTrackPreview` hook while `SongAlbumWithPlay` hand-rolls a parallel `activeSongId` mechanism with duplicated premount timers. Coverage is asymmetric — `SongSuggestionsSection.test.tsx` exists, `MatchesSection` has no test.

**Solution.** One `MatchReviewColumn` module parameterized by orientation (matching the `song`/`playlist` orientation concept the matching backend already has), plus one shared active-preview hook used by both row types.

**Benefits.** ~150 duplicated lines deleted; the coverage gap disappears because there is one module to test; per-orientation churn (the last five commits all touched this area) lands in one place instead of two.

## 4. Match-snapshot-refresh orchestrator — stages instead of a 450-line function

**Files**
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` (698 lines; `executeMatchSnapshotRefresh` spans 242–698)
- Tests: `__tests__/orchestrator-exclusions.test.ts` (399 lines) and `__tests__/msr17-orchestrator-ranking.test.ts` (321 lines), each carrying **17 `vi.mock()` blocks**

**Problem.** `matching/overview.md` names seven stages (target song enrichment, playlist profiling, candidate loading, matching, pair retention, oriented ranking, publishing), but the code inlines them into one function. The tests mock every collaborator, so they assert call sequencing, not behavior — the pure leaves are tested while the wiring, where ordering bugs live, is effectively untested. The sibling `enrichment-pipeline/stages/` decomposition is the in-repo counterexample.

**Solution.** Extract the doc-named stages as independently-testable units; the orchestrator becomes a thin sequencer.

**Benefits.** Each stage gets a real interface to test through instead of a mock sandwich. The docs' vocabulary and the code's structure agree — which is exactly what makes the module AI-navigable.

## 5. Sync snapshot payload — one schema in `shared/`

**Files**
- `src/lib/workflows/spotify-sync/payload-schema.ts` (86 lines — Zod `SyncPayloadSchema`, `SpotifyTrackDTOSchema`, `SpotifyPlaylistDTOSchema`)
- `extensions/src/shared/types.ts` (105 lines — plain-TS mirror; comments `/** Mirrors backend SpotifyTrackDTO — extension cannot import from app source */`)
- `extensions/src/shared/mappers.ts` (118 lines), `extensions/src/background/service-worker.ts` `performSync` body-build (~570–613)

**Problem.** The snapshot wire format — the most failure-prone contract in the system (20MB payloads parsed in a background worker) — is defined twice with no compiler or runtime link, while the lower-risk command protocol already lives in `shared/` and is imported by both sides. Every field addition (`release_year_checked` was the precedent) is a two-place manual edit. Note: the "cannot import from app source" comment is true, but `shared/` is not app source — the extension already imports three other protocols from it.

**Solution.** Move the DTO schema to `shared/extension-sync-payload.ts` as the single Zod source; the extension imports inferred types, the app imports the same schema it already validates with.

**Companion fix.** The command protocol's *result* direction has the same asymmetry: `src/lib/extension/spotify-client.ts:12-48` hand-retypes result shapes that `extensions/src/background/command-handler.ts:35-47` derives via `Awaited<ReturnType<...>>`. Extend `shared/spotify-command-protocol.ts` with a `SpotifyCommandResultMap` so `CommandResponse<T>` is pinned per-command on both sides.

**Benefits.** The seam becomes real — two adapters (extension serializer, app parser) satisfying one interface. Drift becomes a compile error instead of a production parse failure.

## 6. Workflows reaching around domain queries — repair the module-boundary seams

**Files** (all violations of `module-boundaries.md` rule: workflows delegate to domain/platform queries, never raw table access)
- `src/lib/workflows/enrichment-pipeline/stages/matching.ts` (49 lines, `loadExclusionSet`) — raw `.from("match_decision" | "playlist" | "playlist_song")`; imported cross-workflow by `match-snapshot-refresh/orchestrator.ts:38`; **no test exercises its real SQL** (only ever mocked away)
- `src/lib/workflows/enrichment-pipeline/stages/content-activation.ts:22` — inline `.from("account_billing")` one line below an import from `domains/billing/queries.ts`
- `src/lib/workflows/library-processing/queries.ts:124-134` — ad-hoc `job`-table queries parallel to `platform/jobs/repository.ts`
- `src/lib/workflows/library-processing/scheduler.ts:186` — direct `.from("liked_song")`
- `src/lib/workflows/extension-sync/runner.ts:463-513` — three `.from("account")` calls duplicating `domains/library/accounts/queries.ts`

**Problem.** Each duplicated query is a second home for an invariant the domain module already owns ("what pairs are excluded", "how do you find a job by ref"). `loadExclusionSet` is the worst case: it implements the excluded-pairs concept from the matching docs, lives in the wrong workflow, is consumed by a different workflow, and is untested.

**Solution.** Move `loadExclusionSet` into the domain that owns match decisions (e.g. `domains/taste/`), add the missing methods to the existing repositories, and route the workflows through them.

**Benefits.** Each invariant gets exactly one home (locality); the moved queries become testable through domain interfaces that already have test suites around them.

## 7. Liked-songs list — a view-model instead of a four-hook relay

**Files**
- `src/features/liked-songs/LikedSongsPage.tsx` (495 lines — destructures 4+ hook returns and re-wires ~50 named values into child components)
- `hooks/useLikedSongsPageData.ts` (67) → `hooks/useLikedSongsListModel.ts` (98) → `hooks/useSongActivation.ts` (105) → `hooks/useLikedSongsListController.ts` (384 — 17-field options interface, mostly callbacks sourced from the other hooks; 7 returns)
- `hooks/useSongExpansion.ts` (332 — returns 13 flat values)

**Problem.** Understanding list navigation + selection + activation requires bouncing through five files to trace how one callback flows (page → controller → activation → `activateSong`). The hooks fail the deletion test in the telling direction: deleting them relocates complexity into the page rather than removing it — they fragment the concept without concentrating it. `LikedSongsList` already groups its props into `data`/`selection`/`navigation`/`walkthrough` bags — the component knows it wants a view-model that was never built.

**Solution.** Collapse the chain into one `useLikedSongsListViewModel(accountId, filter, search, …)` owning selection, navigation, and activation together, returning grouped objects. Keep `useSongExpansion`'s FLIP/view-transition internals encapsulated (genuinely deep) but shrink its public interface to grouped `{ selection, panel, navigate }`.

**Benefits.** One file to read for the concept; the wiring — where the bugs hide — becomes testable as a unit instead of only via full page mounts.

## 8. Prune pass-throughs and hypothetical seams (small, mostly deletions)

Each item is interface without behaviour; all fail the deletion test cleanly.

| Item | Files | Action |
| --- | --- | --- |
| `changes/` constructor folder | `src/lib/workflows/library-processing/changes/*.ts` (8 files, ~130 lines of `return { kind, ...opts }`) | Collapse into one `changes.ts` or construct union literals at call sites — `types.ts` already documents the full `LibraryProcessingChange` shape |
| `resolveQueuePriority` | `library-processing/queue-priority.ts:23-25` — one line, one caller | Inline `state.queueBand`; keep `bandToNumeric` (real lookup, 2 callers) |
| `EnrichmentContext` dead fields | `enrichment-pipeline/types.ts` — `profilingService`, `llmService`, `rerankerService` carried but never read by any stage; two stages take `_ctx` entirely unused | Each stage declares only what it uses; drop dead fields |
| `createMatchingService` phantom deps | `domains/taste/song-matching/service.ts:119-131` — two `_`-prefixed unused constructor params the sole caller must still construct | `createMatchingService(config?)` |
| ML provider double-wrap | `integrations/deepinfra/service.ts` (447) consumed only by `providers/adapters/deepinfra.ts` (184); same for huggingface | Merge each service into its adapter. The `MLProvider` port itself is a **real seam** (3 adapters via `ML_PROVIDER`) — keep it |
| Caller-less status endpoint | `src/routes/api/extension/sync/status.tsx` (134 lines + own test; zero callers in app or extension) | Delete until a real consumer exists |

**Benefits.** Pure navigability: fewer hops between reading an interface and finding the behaviour, at near-zero risk.

## 9. Walkthrough gate — one seam for "onboarding overrides this screen"

**Files**
- `src/routes/_authenticated/playlists.tsx` — `if (onboardingSession.status === "flag-playlists") return <PlaylistsPreview />`
- `src/routes/_authenticated/match.tsx` — branches on `"match-walkthrough" | "song-walkthrough"` → `WalkthroughMatchContent`
- `src/features/liked-songs/LikedSongsPage.tsx` — branches on `"song-walkthrough"`, fetches `companionSongs`, threads `isWalkthrough` through props

**Problem.** Three routes reimplement the walkthrough gate with different names and different consequences (swap component / thread a boolean through five props / fetch extra data). Understanding how onboarding takes over a screen requires reading all three routes plus `step-resolver.ts`.

**Solution.** One `useWalkthroughGate(routeName)` returning a discriminated `{ mode: "live" } | { mode: "walkthrough"; … }`, composed identically in every route.

**Benefits.** Adding a walkthrough to a fourth route becomes one call; the step→route mapping in `onboarding.md` gets a single code counterpart.

## 10. One checkout-initiation module

**Files**
- `src/features/billing/hooks/useCheckoutFlow.ts` (78 lines) — used correctly by `PaywallCTA.tsx`
- `src/features/onboarding/components/PlanSelectionStep.tsx:154-202` — hand-rolled `handleCheckout` duplicating the same build-intent → `createCheckoutSession` → `parseStripeCheckoutUrl` → `saveCheckoutIntent` → redirect → toast/clear-on-error sequence

**Problem.** Two implementations of "start a Stripe checkout" that have already diverged: `PlanSelectionStep` reuses a persisted `checkoutAttemptId` when the offer matches; `useCheckoutFlow` always mints a fresh one.

**Solution.** Extend `useCheckoutFlow` with the attempt-id-reuse option and make `PlanSelectionStep` use it.

**Benefits.** Payment-flow drift is the expensive kind; this makes it structurally impossible, and the existing `useCheckoutFlow` tests start covering onboarding too.

---

## Deliberately not on the list

- **`SongDetailPanelSurface.tsx` (2019 lines, ~16 nested sub-components).** Its props interface is already deep — billing-agnostic, pre-resolved callbacks. The problem is file organization, not architecture; a mechanical split under `song-detail-panel/surface/` needs no interface change and no grilling.
- **`library-processing` control plane spread (15 files, ~2170 lines).** Well-tested, each file defensibly single-purpose; the friction is navigational. Candidate 8 already trims its worst fragments (`changes/`, `queue-priority`). Revisit only if the module keeps growing.
- **`ClaimHandleStep` / `PlanSelectionStep` embedded state machines** (765 / 629 lines, tested only through full renders — `ClaimHandleStep.test.tsx` is 1298 lines). Real friction, but lower leverage than the candidates above; the pattern fix is the same as candidate 2 (extract a pure reducer/hook, test input→output).

## Deep modules worth imitating (found during review)

- `shared/spotify-command-protocol.ts` — versioned, runtime-validated, imported by both sides, one exhaustive dispatcher
- `shared/extension-bridge-protocol.ts` + `extensions/src/content/app-bridge.ts` — tight, documented relay protocol
- `extensions/src/shared/spotify-client/**` — all Spotify Pathfinder access concentrated in one place
- `src/lib/workflows/enrichment-pipeline/stages/*` — orchestration decomposed into testable stages
- `src/features/matching/queue-helpers.ts`, `bootstrap-ready-queue.ts`, `match-search.ts`, `useDashboardSync` (`{ state, onAction }`) — pure, small-surface, fully tested
- `SongDetailPanel.tsx` (wrapper) — chrome/animation/shortcuts encapsulated behind a narrow prop surface
