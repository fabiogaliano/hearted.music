# Architecture & Design Pattern Review — 2026-07-02

Principal-level inspection of the whole stack: layering, TypeScript boundaries, TanStack Start/Router/Query usage, React patterns, failure design, and developer velocity. Every claim below was verified against the code (file:line). Seven parallel exploration passes covered: the route tree, `liked-songs` + `matching` end-to-end, `onboarding`/`dashboard`/`playlists`/`billing`, the domain layer and type boundaries, the worker lifecycle, `shared/` + extension + control-panel, and React rendering.

**Relationship to [`deepening-opportunities-2026-07-02.md`](./deepening-opportunities-2026-07-02.md):** that doc is the micro view — turning shallow modules into deep ones. This doc is the macro view — the system-wide patterns those modules live inside. Where a finding overlaps (match review mutations ↔ its #2, sync payload schema ↔ its #5, domain bypasses ↔ its #6), this doc references it instead of repeating it. The two lists are compatible; where both name the same area, do the deepening-doc extraction first and land the pattern from this doc on the extracted module.

---

## 1. Executive summary — four structural truths

**1. The layering is real, and most of it must be preserved.** Features never touch Supabase (zero `supabase`/`.from(` hits under `src/features/**`); server functions live in exactly one place (`src/lib/server/*.functions.ts`, 69 `createServerFn` sites, none in features); web and worker share one orchestration layer (`src/lib/workflows/**`) so scoring/matching/billing logic has a single home — `strictnessScore()` is imported identically by both runtimes. Stripe is fully externalized (no Stripe SDK anywhere; an HMAC-verified bridge plus a URL-host allowlist in `src/lib/domains/billing/stripe-redirects.ts`). Root `shared/` is a disciplined, genuinely bilateral protocol layer. The control panel imports the app's own domain functions rather than reimplementing them (`control-panel/server/operations.ts:9-19`). This discipline is held almost entirely by convention — the only mechanical enforcement is `biome.json`'s `noProcessEnv: "error"`. The improvements below add enforcement to conventions that already exist; none of them change the architecture's shape.

**2. The read path is systematized; the write path is artisanal.** Queries have per-feature key factories + `queryOptions` (`dashboardKeys`, `matchReviewKeys`, `likedSongsKeys`…), loader `ensureQueryData` prefetch, aggregate-fetch-then-seed (`seedDashboardCaches`), and adaptive `refetchInterval` polling written into the same cache. Mutations have **no shared abstraction at all**: zero `useMutation` calls in the entire codebase (verified). Every write is a hand-rolled `await serverFn` → check → invalidate/patch, producing the 5×-repeated try/lock/release shape in `match.tsx`, three independent implementations of the Spotify write-through flow, spinner-and-wait unlock UX, and no optimistic updates on the app's core review loop. This is the single largest systematic gap — it costs fluidity, duplication, and error-consistency simultaneously.

**3. Type and error rigor is inverted across boundaries.** The *adversarial* edges are the best-validated code in the repo: LLM output via `generateObject({schema})`, lyrics scrapers with per-provider `safeParse` + typed errors, the 20MB extension payload through `SyncPayloadSchema`, every server fn behind `authMiddleware` + Zod `.inputValidator`. Meanwhile the *internal* edges are trusted blind: `(data ?? []) as SomeRow[]` on Supabase RPC results at 10+ sites including the job queues and liked-songs pagination, and hand-typed row shapes that shadow `Tables<>`. Error handling has the same inversion: a genuinely good `Result<T,E>` + `TaggedError` system spans 252 files up to the domain boundary, then fractures into three ad-hoc conventions at the server-fn edge (`{success:false}` unions, silent `return null`, ~30 raw `throw new Error` in `playlists.functions.ts` alone), with `captureServerError` adopted in only 9 of the files under `src/lib/server` — errors returned as `null` produce zero telemetry.

**4. The worker is the most mature subsystem; the web tier's failure design lags it.** The worker has an event-sourced reconciler (`reconcileLibraryProcessing` — pure reducer over a closed change union), `FOR UPDATE SKIP LOCKED` claims everywhere, five-layer crash recovery run blocking at startup, and a per-failure-code poison policy with jittered backoff and customer compensation. The web tier, by contrast, has silent `catch {}` blocks in `match.tsx`, three uncoordinated logging channels (`log.*` worker-only, 101 raw `console.*` sites, partial `captureServerError`), and no correlation id linking a web request to the job it spawned. The worker's one real inversion: an application-thrown error fails a job permanently on attempt 1 while a *crashed worker* gets 3 retries.

---

## 2. Top 10 improvements (ranked by leverage)

### #1 — One result envelope from server fn to client, with telemetry built in

**Problem.** Three error conventions coexist at the `*.functions.ts` boundary, sometimes in one file: typed unions (`billing.functions.ts:127,262` — `{ success: false, error: "rate_limited" | ... }`), silent nulls (`matching.functions.ts:154,162,260` — `if (Result.isError(x)) return null`), and raw throws (`playlists.functions.ts` — 30 `throw new Error` sites incl. `"Playlist not found"` at :153, :163, :268, :274, sitting next to typed-union siblings). Client code must `try/catch` *and* check `.success` depending on which fn it called (`match.tsx:1163-1193` does both for one flow). `captureServerError` — whose own doc comment names this exact failure mode — is called from only 9 files under `src/lib/server`; the silent-null files produce no telemetry at all.

**Target pattern.** One helper that adapts domain `Result` to a single client shape and captures on the way out:

```ts
// src/lib/server/respond.ts
export type ServerResult<T, E extends string = never> =
	| { ok: true; data: T }
	| { ok: false; error: E | "internal" };

export async function respond<T, E extends string>(
	operation: string,
	run: () => Promise<Result<T, DbError | TaggedErrorWithCode<E>>>,
): Promise<ServerResult<T, E>> {
	const result = await run();
	if (Result.isOk(result)) return { ok: true, data: result.value };
	captureServerError(result.error, { operation });
	return { ok: false, error: clientCode(result.error) };
}
```

Rewritten call site (`playlists.functions.ts` `setPlaylistTargetMutation`):

```ts
.handler(({ data, context }) =>
	respond("playlists.setTarget", () =>
		setPlaylistTarget(context.accountId, data.playlistId, data.isTarget),
	),
);
// client: const r = await setPlaylistTargetMutation({data}); if (!r.ok) toast(copyFor(r.error));
```

**Migration.** Fully incremental, file-by-file — start with `playlists.functions.ts` (worst offender) and any file with silent nulls (`matching.functions.ts`). New fns must use `respond`. No client big-bang: each converted fn's call sites are converted with it.

**Risk.** Low. The main hazard is loaders that *want* a throw so `errorComponent` catches it — keep `respond` for mutations/nullable reads and let loader-critical reads throw a typed error deliberately (document which).

### #2 — A mutation convention: `mutationOptions` factories + optimistic updates on the review loop

**Problem.** Zero `useMutation` anywhere (verified repo-wide). Consequences, all verified: the `if (!onLockNavigation()) return; try {...} catch { onReleaseNavigation(); }` shape appears 5× in `match.tsx` (:867, :1013, :1124, :1163, :1195); the "Spotify write-through → reconnect check → server persist → local added-state" flow is implemented 3× (`useSongPlaylistSuggestions.ts:51-77` + both mode branches of `handleAdd`, `match.tsx:1013-1122`); unlock shows a spinner for the full round-trip *plus* refetch (`useSongUnlock.ts:49-76` awaits `Promise.all([invalidate×3])` before showing success); dismiss/add on the match queue — the app's core interaction — waits for the server before any visual change; `match.tsx:1220-1222` swallows failures with a bare `catch {}`.

**Target pattern.** Per-feature `mutations.ts` next to `queries.ts`, using `mutationOptions` (available in `@tanstack/react-query@5.90`):

```ts
// src/features/matching/mutations.ts
export function dismissSuggestionMutation(qc: QueryClient, itemId: string) {
	const key = presentMatchReviewItemQueryOptions(itemId).queryKey;
	return mutationOptions({
		mutationFn: (suggestionId: string) =>
			dismissMatchReviewItemSuggestion({ data: { itemId, suggestionId } }),
		onMutate: async (suggestionId) => {
			await qc.cancelQueries({ queryKey: key });
			const previous = qc.getQueryData(key);
			qc.setQueryData(key, (cur) => removeSuggestion(cur, suggestionId));
			return { previous };
		},
		onError: (err, _id, ctx) => {
			qc.setQueryData(key, ctx?.previous);
			captureRouteError(err, { operation: "match.dismissSuggestion" });
		},
	});
}
```

`useMutation(...).isPending` replaces the hand-rolled navigation lock; the rollback in `onError` replaces the silent catch. The Spotify write-through flow becomes one shared `useSpotifyWriteThrough` hook consumed by both features.

**Migration.** Do deepening-doc #2 (extract `useMatchReviewSession`) first, then land these as its internals. Order of adoption by user-perceived payoff: dismiss suggestion → add-to-playlist → dismiss/next → unlock. Each is an independent PR.

**Risk.** Medium. Optimistic updates on the queue interact with the `locallyResolvedIds` overlay (`match.tsx:422,467-479`) — resolve that first by folding local resolution into cache updates, or the two systems will disagree mid-flight. The Spotify write-through mutations must stay *pessimistic on the Spotify call* (external side effect) while being optimistic on the local queue advance — split the two steps in the mutationFn accordingly.

### #3 — Close the RPC cast hole with a validated wrapper

**Problem.** The one internal boundary with no runtime check is Supabase `.rpc()` results: `(data ?? []) as LikedSongPageRow[]` ×3 (`domains/library/liked-songs/queries.ts:251,289,381` — verified), `as BackfillJob[]` on the lease-fenced claim path (`domains/enrichment/audio-feature-backfill/jobs.ts:42,329`), plus `platform/jobs/library-processing-queue.ts:288,307`, `sync-phase-jobs.ts:76`, `extension-sync-jobs.ts:155,202`. The codebase *already has* the right pattern for table queries — `fromSupabaseSingle/Many/Maybe` in `src/lib/shared/utils/result-wrappers/supabase.ts` with `mapPostgrestError` — RPCs just never got the equivalent. A migration that changes an RPC's return shape currently fails as `undefined` downstream, not as a typed error.

**Target pattern.** Extend the existing wrapper family:

```ts
// src/lib/shared/utils/result-wrappers/supabase.ts
export async function fromSupabaseRpc<S extends z.ZodType>(
	schema: S,
	rpc: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<Result<z.infer<S>, DbError>> {
	const { data, error } = await rpc;
	if (error) return Result.error(mapPostgrestError(error));
	const parsed = schema.safeParse(data ?? []);
	return parsed.success
		? Result.ok(parsed.data)
		: Result.error(new DatabaseError({ message: "rpc shape mismatch", cause: parsed.error }));
}
```

Call site: `const rows = await fromSupabaseRpc(LikedSongPageRowSchema.array(), supabase.rpc("get_liked_songs_page", args));` — and `LikedSongPageRow` becomes `z.infer` of that schema, deleting the hand-maintained interface (same move kills the drift pairs: `SongRow`/`AudioRow`/`PlaylistRow` in `match-review-queue.read.ts:6-29` should become `Pick<Tables<...>>`).

**Migration.** Site-by-site; start with the two highest-consequence paths (liked-songs pagination, job claims). ~12 call sites total.

**Risk.** Low. One real cost: Zod parse on hot pagination paths — use `z.looseObject` row schemas (Zod 4) and parse once per page, which is noise next to the network hop.

### #4 — Fix the worker's inverted retry policy; extract one poll-loop kit

**Problem.** `markJobFailedSafe` (`workflows/library-processing/runner.ts:448`, called at :195, :313 — verified) terminalizes a job on the *first* application throw; the `attempts < max_attempts` machinery only fires for stale-heartbeat (crash) recovery. A transient DB blip permanently fails a job while a dead worker gets 3 retries — backwards. Meanwhile the poll-loop infrastructure (`shouldPoll` flag, `activeJobs` set, heartbeat, shutdown drain) is copy-pasted 3× (`poll.ts`, `poll-extension-sync.ts`, `poll-audio-feature-backfill.ts`) with three near-identical SQL claim/sweep/dead-letter triads (one migration literally comments "Clone of `claim_pending_library_processing_job`"), so any policy fix must be applied three times or silently cover one pipeline.

**Target pattern.** (a) On application error: classify (reuse the `instanceof`-based classification idiom from `failure-classification.ts`); transient → increment `attempts`, set `status: pending` with a `next_attempt_at` backoff (the jittered helper already exists in `withRetry`/`failure-policy.ts`); terminal or exhausted → `failed`. (b) One `createPollLoop({ name, claim, execute, heartbeat, drain })` module consumed by all three pipelines, so the retry fix lands once.

**Migration.** (a) is a contained change to `runner.ts` + one migration adding `next_attempt_at` to the claim RPC's `WHERE`. (b) is mechanical extraction, one pipeline at a time, behind the existing tests.

**Risk.** Medium-low. Retrying application errors requires the job body to be resume-safe — the `progress` checkpointing already exists (`updateJobProgress`), but audit external-call sites between checkpoints (LLM calls redone on resume have real cost). Gate retry classification conservatively: default to terminal, allowlist transient codes.

### #5 — Make the feature boundary a rule: keys are shared infrastructure, features don't import features

**Problem.** 25+ cross-feature imports with three *bidirectional* pairs (billing↔onboarding via `checkout-intent`, dashboard↔matching via types/keys, playlists↔matching via `Cover`/queries), onboarding tour internals wired directly into the production playlists route (`routes/_authenticated/playlists.tsx:3-13`), and `src/lib/hooks/useActiveJobs.ts` — a *lib* module — importing three features' query factories for invalidation. The dominant coupling vector is cache invalidation: features import each other's key factories. The codebase already discovered the fix once: `features/billing/query-keys.ts` was split into a tiny file precisely because other features needed it — it just still lives inside a feature folder.

**Target pattern.** Two moves plus one rule. (a) Key factories (tiny, dependency-free `as const` objects) move to `src/lib/query-keys/<domain>.ts`; `queryOptions` stay feature-private. Now `useActiveJobs`, `matching/queries.ts`, and `settings` invalidate via lib imports, not feature imports. (b) Genuinely shared concepts get neutral homes: `checkout-intent` → `src/lib/domains/billing/` (it is billing state persisted client-side); `Cover` → `src/components/`; the walkthrough gate → one hook per deepening-doc #9. (c) The rule — "`src/features/X` may import `src/lib/**` and `src/components/**`, never `src/features/Y`" — enforced by a ~40-line Bun script in lefthook/CI that greps import specifiers (Biome can't express this today; keep the check dumb and fast).

**Migration.** Move key files first (pure mechanical, high payoff), then the three bidirectional pairs, then turn on the check. Landing/`devtools` imports of feature components can be grandfathered with an explicit allowlist in the script rather than blocking.

**Risk.** Low. The only judgment calls are which shared components are truly generic (move) vs. matching-specific (stay); the script's allowlist makes that decision reversible.

### #6 — A correlation spine: request id → job → Sentry tags, one logging façade

**Problem.** No `traceId`/`requestId`/`correlationId` exists anywhere in `src/worker`, `src/lib/platform/jobs`, or `src/lib/observability` (verified by the worker audit's grep). Diagnosing "why did user X's enrichment fail" means manually matching `accountId` strings across worker stdout, Sentry, and PostHog. Worse, `job-failure-reporting.ts:13-16` puts `jobId`/`accountId` in Sentry `extra` (visible per-event, not searchable) rather than `tags`. And there are three logging channels: `log.*` (89 sites, worker/workflows only — zero usage in `src/lib/server` or routes), raw `console.*` (101 sites), and partial `captureServerError`.

**Target pattern.** (a) Generate a `requestId` in the server-fn middleware chain (next to `authMiddleware`); pass it through `applyLibraryProcessingChange` into job rows (a nullable `origin_request_id` column or a key inside the existing `progress`/metadata JSON). (b) In the worker, `Sentry.setTags({ jobId, accountId, originRequestId })` at claim time; flip existing `extra` → `tags`. (c) Route `src/lib/server` errors through the same `log.*` logger (via #1's `respond`, which gives you the single choke point for free).

**Migration.** (b) is an hour; (a) is a day including the migration; (c) rides on #1's adoption.

**Risk.** Low. Cardinality of `requestId` as a Sentry tag is fine at this scale; if it ever isn't, keep it in `extra` and only `jobId`/`accountId` as tags.

### #7 — Route-level pending/error defaults; finish the loader story

**Problem.** Only `/match` defines `pendingComponent`/`errorComponent` (`match.tsx:95-97`); `router.tsx:21-28` sets no defaults, so every other route blocks on its loader with no pending UI. Three loaders bypass React Query entirely (`settings.tsx:23`, `index.tsx:31`, `@{$handle}.tsx:26` — raw server-fn calls into router cache, invisible to invalidation/devtools). Two primary routes leave secondary data to fetch-on-render waterfalls: liked-songs stats (`useLikedSongsPageData.ts:50-53`, not in the loader) and playlists top-genres (`PlaylistsCoverFlowScreen.tsx:67`). And `checkout/success.tsx:61-64` re-reads `billingKeys.state` with no `staleTime`, disagreeing with the layout route's 5-minute policy for the same key — a symptom of the QueryClient having no `defaultOptions` at all (`root-provider.tsx`).

**Target pattern.** (a) `defaultPendingComponent` + `defaultErrorComponent` on `createRouter`, with `defaultPendingMs`/`defaultPendingMinMs` tuned so fast loaders never flash. (b) Convert the three raw loaders to `ensureQueryData(queryOptions(...))` — mechanical. (c) In loaders, `void queryClient.prefetchQuery(...)` (not awaited) for secondary data so it streams in warm without blocking navigation. (d) Set a modest global `staleTime` (e.g. 30s) in `getContext()` so unannotated reads stop meaning `staleTime: 0`.

**Migration.** Each of (a)–(d) is an independent sub-hour change.

**Risk.** Low. (d) is the only behavioral one — audit the few reads that *rely* on always-refetch (the onboarding guard already forces `staleTime: 0` explicitly, which is correct and unaffected).

### #8 — Virtualize the liked-songs list

**Problem.** No windowing library exists in the repo (verified: no `@tanstack/react-virtual`/`react-window` anywhere). `LikedSongsList.tsx:166-209` renders every loaded song and the infinite-scroll sentinel only ever *adds* pages — a heavy library accumulates thousands of mounted, memoized `SongCard`s. `memo` + `useCallback` discipline (already in place) caps re-render cost but not mount/DOM cost.

**Target pattern.** `@tanstack/react-virtual` on the list container. The state design already cooperates: selection/activation is id-based, not element-based (`useSongExpansion` stores `selectedSongId` and re-derives), so windowing doesn't break selection.

**Migration.** One PR behind a Ladle story with a 2,000-row fixture (the fixture pipeline already exists — `build-fixtures.ts`).

**Risk.** Medium — the real interactions are (a) the FLIP/View-Transition expansion in `useSongExpansion` needs the source element mounted: scroll-to-index before expanding; (b) keyboard navigation in `useLikedSongsListController` assumes focusable rows: keep focus by id + `scrollToIndex`. This is why it ranks #8 despite user-visible payoff — do it after #2 so the list's mutation story is stable first.

### #9 — Structural server/client env split

**Problem.** `env.ts` is one undifferentiated `createEnv` module holding both server secrets and client vars. `UserJotWidget.tsx:3` (browser component — verified) imports it to read one public var, which ships the full server-secret *schema and name inventory* into the client bundle as dead code (verified against `dist/client`: the literal `SUPABASE_SERVICE_ROLE_KEY` string is present; no secret *values* leak — t3-env's `isServer` guard holds at runtime). `env.public.ts` already exists as the client-safe accessor but is a second hand-maintained copy of the client block. Separately, a few client-reachable modules co-locate Zod schemas with service-role query code (e.g. `song-detail-adapter.ts` importing from domain query files), keeping secrets out of the bundle by tree-shaking luck rather than structure.

**Target pattern.** Rename `env.ts` → `env.server.ts` (TanStack Start/Vite enforce `.server` files never reach the client bundle); `env.public.ts` becomes the only client import; fix `UserJotWidget` to use `clientEnv`. For the co-located schema files: split schema-only modules (`<thing>.schema.ts`) from query modules so client imports never touch files containing `createAdminSupabaseClient`.

**Migration.** Rename + import-fix is mechanical (grep `from "@/env"` in client-reachable files). Schema splits: only where a client import actually crosses today (~2 files).

**Risk.** Minimal; the failure mode of *not* doing it is someone adding a top-level side effect to `env.ts` and turning dead code into a live leak.

### #10 — Effects and polling hygiene: apply the house pattern the house already wrote

**Problem.** The codebase contains its own correct answers — render-time state adjustment with an explanatory comment (`SongSuggestionsSection.tsx:59-63`, `useVocalsAutoFill.ts:83-103`) and `refetchInterval` as a pure function of query state (`useLikedSongsCollection.ts:103-105`) — yet six verified mirror-state effects and four hand-rolled poll loops sit next to them: `useDashboardSync.ts:104-136` (poll interval derived via effect+setState; :258-261 folds `spotifyConnected` back into `phase` — verified), `PlanSelectionStep.tsx:103-146` (manual fetch-on-mount *next to* a real `useQuery` in the same component), `useCheckoutPolling.ts:28-69` (hand-written `setTimeout` loop), `ExtensionStatusRow.tsx:31-40` (`.then` + cancelled flag), `useSpotlightEditor.ts:98-102,155-164` (the latter with a comment admitting it's shaped to dodge the lint rule), `match.tsx:467-479`. Each mirror effect is an extra render cycle and a transient-inconsistency window.

**Target pattern.** No new abstraction needed: derive during render (`const statusPollMs = phase === "triggering" || sync?.status === "syncing" ? ACTIVE : IDLE`), fold transitions into the existing `deriveState` reducers, and convert the four poll loops to `useQuery` + `refetchInterval` (the exact pattern `useActiveJobs` already demonstrates).

**Migration.** Six independent small PRs; `useDashboardSync` first (it has three of the offenses and a 9-variant UI-state union that makes the reducer fold natural).

**Risk.** Low. `useSongExpansion.ts:159-198`'s URL-reconciliation effect is the one *justified* member of this family (browser back/forward vs. FLIP choreography) — leave it, per the steelman in the trace.

---

## 3. Pattern ledger

| | Pattern | Evidence / replacement |
|---|---|---|
| **Keep** | Per-feature `queries.ts` = key factory + `queryOptions`, prefix-invalidation roots, documented key-exclusion comments | `matching/queries.ts:13-29`, `dashboard/queries.ts:11-20` |
| **Keep** | Aggregate-fetch-then-seed loaders | `dashboard.tsx:14-20` + `seedDashboardCaches` |
| **Keep** | `authMiddleware` + Zod `.inputValidator` on every server fn | 69 sites, `src/lib/server/*.functions.ts` |
| **Keep** | `Result<T,E>` + `TaggedError` taxonomy; `fromSupabase*` wrappers; zero `class X extends Error`, zero `@ts-ignore` in `src/` | `shared/errors/`, `result-wrappers/supabase.ts` |
| **Keep** | Discriminated unions with single construction points | `OnboardingSession` + `deriveSession`; `billing/state.ts` (+ its Stripe-status normalization table); `DashboardSyncUiState` |
| **Keep** | Reconciler/effect state machine for job orchestration; `FOR UPDATE SKIP LOCKED`; layered startup sweep; per-code poison policy with compensation | `reconciler.ts`, claim RPC migrations, `sweep.ts`, `failure-policy.ts` |
| **Keep** | Typed-error + timeout + 429/Retry-After + jittered `withRetry` at every integration; AI SDK internal retry disabled deliberately | `reccobeats/service.ts`, `llm/service.ts:218,364-373` |
| **Keep** | Context splitting (stable actions vs. changing state); playback state local and never ticking; GSAP isolated from React ownership | `KeyboardShortcutProvider.tsx:32-42`, `SpotifyEmbedIframe.tsx`, `useHeroAnimation.ts` |
| **Keep** | Fixture-driven Ladle from real Supabase exports; pure derivation modules with dedicated tests | `build-fixtures.ts`, `queue-helpers.ts`, `match-search.ts` |
| **Keep** | Root `shared/` as bilateral wire-protocol only; control-panel reusing domain functions; `noProcessEnv` biome rule | `shared/*.ts`, `control-panel/server/operations.ts:9-19`, `biome.json:37-39` |
| **Stop** | Raw `throw new Error` / silent `return null` from server fns | → #1 `respond` envelope |
| **Stop** | Hand-rolled mutation flows (lock flags, manual cache patches, bare `catch {}`) | → #2 `mutationOptions` factories |
| **Stop** | `(data ?? []) as Row[]` on RPC results; hand-typed row shadows (`match-review-queue.read.ts:6-29`, the narrowed `AnalysisContent` in `matching.functions.ts:45-53`) | → #3 `fromSupabaseRpc` + `Pick<Tables<...>>`/`z.infer` |
| **Stop** | Raw `.from()` in the server-fn layer beside domain imports (`match-review-queue.functions.ts:206…1704`, `onboarding-session.ts:150-173`) | → move into domain queries (extends deepening-doc #6 to the server layer) |
| **Stop** | Mirror-state effects and hand-rolled poll loops | → #10, render-time derivation / `refetchInterval` |
| **Stop** | Features importing features (esp. key factories) for invalidation | → #5 `src/lib/query-keys/` + boundary check |
| **Start** | Optimistic updates on the review loop; `isPending` as the interaction lock | #2 |
| **Start** | Correlation ids + Sentry tags (not extras) across request → job | #6 |
| **Start** | `defaultPendingComponent`/`defaultErrorComponent`; global `staleTime` default | #7 |
| **Start** | Transient-vs-terminal retry classification for app-level job errors; single poll-loop kit; job-type registry to collapse the 8-touch add-a-job checklist | #4 |
| **Start** | Import-boundary check in lefthook/CI (features↔features; extension→`src/**` outside `shared/`) | #5, quick win 3 |
| **Start** | Virtualization on liked-songs | #8 |

---

## 4. Quick wins (≈1 hour each)

1. **Fix the stuck-preview bug**: `SpotifyEmbedIframe.tsx:9` declares `addListener` but nothing ever subscribes — a preview that ends naturally leaves the "now playing" UI stuck. Subscribe to `playback_update` and call the deactivate callback on ended.
2. **`UserJotWidget.tsx:3`** → import `clientEnv` from `@/env.public` instead of `@/env` (removes the server-secret schema from the client bundle today, independent of #9).
3. **Move `ConcurrencyLimiter`/`mapWithConcurrency` to root `shared/`** — the extension imports them from `src/lib/shared/utils/concurrency` at 3 sites (`service-worker.ts:22`, `release-year-hydration.ts:1`, `spotify-request-policy.ts:1`), a boundary bypass that only works because the file happens to be pure.
4. **`onboarding.tsx:43`'s local `ONBOARDING_DATA_QUERY_KEY`** → move next to `ONBOARDING_SESSION_QUERY_KEY` in `platform/auth/query-keys.ts`; it's currently safe only because the loader forces `staleTime: 0`.
5. **`unlimited-subscription-gift.ts:94`** compares raw `subscription_status === "active"` two files from the module that says "callers should never compare against raw Stripe strings" — use the normalized status.
6. **`checkout/success.tsx:61-64`** → reuse the shared billing queryOptions (with its `staleTime`) instead of an inline `useQuery` that silently refetches.
7. **`job-failure-reporting.ts:13-16`**: move `jobId`/`accountId` from Sentry `extra` to `tags` so incidents are searchable by job.
8. **Router defaults**: wire `defaultPendingComponent`/`defaultErrorComponent` (the standalone slice of #7).
9. **`README.md:224-231`** still describes `extension/` (singular) with one shared file — stale in exactly the way that misleads someone placing a new contract type.

---

## 5. North-star: adding a feature after these changes

A new authenticated feature ("collections", say) means writing five files and touching two known registration points — nothing else:

```
src/routes/_authenticated/collections.tsx     — validateSearch (Zod), loader: ensureQueryData(+ void prefetch
                                                 for secondary data); pending/error come from router defaults
src/features/collections/CollectionsPage.tsx  — screen composed of small named components
src/features/collections/queries.ts           — queryOptions over collectionsKeys
src/features/collections/mutations.ts         — mutationOptions factories (optimistic where UX warrants)
src/lib/query-keys/collections.ts             — key factory (shared infrastructure, importable by anyone)
src/lib/server/collections.functions.ts       — createServerFn + authMiddleware + inputValidator + respond()
src/lib/domains/library/collections/queries.ts — Supabase via fromSupabase*/fromSupabaseRpc, Result<T, DbError>
```

Registration points: a Sidebar entry, and a `step-resolver.ts` case *only if* the route participates in onboarding. Everything else is inherited, not written: the error envelope and its telemetry (#1), rollback-safe mutation shape (#2), runtime-validated DB reads (#3), pending/error UI (#7), correlation ids (#6), and Ladle fixtures from the existing pipeline. If the feature needs background work, the job registry from #4 reduces today's 8-file checklist (Zod progress schema + handler + registry entry, with the claim SQL driven by the registry's type list) — the reconciler, claiming, sweeping, retry, and poison handling all come for free.

The test surface follows the same shape: domain queries tested against schemas, mutation factories tested as input→output (no rendering), the screen tested through Ladle fixtures — the seams these ten changes create are exactly the seams the deepening doc's extractions want to be tested through.
