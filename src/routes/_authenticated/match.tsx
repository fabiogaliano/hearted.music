import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { dashboardKeys } from "@/features/dashboard/queries";
import { bootstrapReadyMatchQueue } from "@/features/matching/bootstrap-ready-queue";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { MatchModeToggle } from "@/features/matching/components/MatchModeToggle";
import { Matching } from "@/features/matching/Matching";
import {
	hasNonCanonicalMatchMode,
	modeFromSearch,
	validateMatchSearch,
} from "@/features/matching/match-search";
import {
	matchReviewBootstrapQueryOptions,
	matchReviewKeys,
	matchReviewQueryOptions,
	matchReviewSummaryKeys,
	presentMatchReviewItemQueryOptions,
} from "@/features/matching/queries";
import {
	countAppendedFromTotal,
	deriveCaughtUp,
	deriveEmptyStateReason,
	deriveProgressIndex,
	deriveUnresolvedIds,
	nextItemIdAfterResolved,
	resolveCurrentItemId,
	shouldBootstrapReadyQueue,
	shouldOfferLoosenStrictness,
} from "@/features/matching/queue-helpers";
import type {
	CompletionStats,
	MatchingReviewItem,
	MatchingSuggestion,
	MatchViewMode,
	ReviewedItem,
} from "@/features/matching/types";
import { WalkthroughMatchContent } from "@/features/matching/WalkthroughMatchContent";
import { sessionMode } from "@/lib/domains/library/accounts/onboarding-session";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { captureRouteError } from "@/lib/observability/sentry";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import {
	addSongToPlaylistFromQueueItem,
	dismissMatchReviewItem,
	finishMatchReviewItem,
	markMatchReviewItemPresented,
} from "@/lib/server/match-review-queue.functions";
import { setMatchViewModePreference } from "@/lib/server/settings.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/match")({
	// `mode=song` is non-canonical (A3) — `/match` is the canonical song-mode URL.
	// Any non-`playlist` mode value in the URL is replaced with the bare `/match`
	// before the loader runs, preventing push-loop behavior via replace: true.
	validateSearch: validateMatchSearch,
	beforeLoad: ({ location }) => {
		const rawParams = Object.fromEntries(
			new URLSearchParams(location.searchStr),
		);
		if (hasNonCanonicalMatchMode(rawParams)) {
			throw redirect({ to: "/match", replace: true });
		}
	},
	// /_authenticated already resolved the session via resolveSession. Bootstrap
	// (create/resume) and the queue read moved off the loader into a client-side
	// Suspense boundary — see MatchPage → QueueMatchPage. Awaiting create/resume
	// here blocked SSR on the page's slowest step (16s FCP while a large library
	// enriches); now the shell + a spinner stream immediately and the queue
	// resolves under the boundary. The loader stays only to short-circuit
	// walkthrough modes, which have no queue (the DU guarantees song presence).
	loader: ({ context }) => {
		if (sessionMode(context.onboardingSession) === "walkthrough") return;
	},
	errorComponent: MatchErrorComponent,
	pendingComponent: MatchPending,
	component: MatchPage,
});

function MatchPending() {
	return <div className="mx-auto w-full max-w-[min(1600px,100%)]" />;
}

// Streamed while the client-side bootstrap + queue read resolve under the
// Suspense boundary (B1). A slow/enriching-library bootstrap now shows this
// spinner instead of blank HTML or a hard error.
function MatchLoading() {
	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<div
				className="flex min-h-[calc(100dvh-160px)] items-center justify-center"
				role="status"
				aria-label="Loading matches"
			>
				<div className="theme-text-muted size-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
			</div>
		</div>
	);
}

// Catches a failed bootstrap/queue read (thrown by the client Suspense queries)
// so it renders a retry inside the app shell rather than bubbling to the
// full-page _authenticated error fallback. resetQueries clears the errored
// match-review caches so `reset()` re-mounts into a fresh fetch.
function MatchErrorComponent({ error, reset }: ErrorComponentProps) {
	const queryClient = useQueryClient();

	useEffect(() => {
		captureRouteError(error, { route: "_authenticated/match" });
	}, [error]);

	const handleRetry = () => {
		queryClient.resetQueries({ queryKey: matchReviewKeys.all });
		reset();
	};

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<div
				className="flex min-h-[calc(100dvh-160px)] flex-col items-center justify-center px-8 text-center md:px-16"
				role="alert"
				style={{ fontFamily: fonts.body }}
			>
				<p className="theme-text-muted mb-6 text-xs tracking-widest uppercase">
					something went wrong
				</p>
				<h1
					className="theme-text max-w-[520px] text-[44px] leading-[1.1] font-extralight tracking-tight text-balance md:text-[54px]"
					style={{ fontFamily: fonts.display }}
				>
					We couldn't load <em>your matches.</em>
				</h1>
				<button
					type="button"
					onClick={handleRetry}
					className="theme-text mt-12 text-base font-medium tracking-wide"
					style={{ fontFamily: fonts.body }}
				>
					Try again →
				</button>
			</div>
		</div>
	);
}

function MatchPage() {
	const { onboardingSession } = Route.useRouteContext();

	if (
		onboardingSession.status === "match-walkthrough" ||
		onboardingSession.status === "song-walkthrough"
	) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<WalkthroughMatchContent walkthroughSong={onboardingSession.song} />
			</div>
		);
	}

	return (
		<Suspense fallback={<MatchLoading />}>
			<QueueMatchPage />
		</Suspense>
	);
}

function QueueMatchPage() {
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	// Read mode from validated URL search. The bootstrap query below (not the
	// loader) creates/resumes the correct orientation session.
	const mode = modeFromSearch(Route.useSearch());

	// Ensure the active session exists before reading the queue. Two suspense
	// queries in one component sequence naturally: React halts the render at the
	// first suspend, so bootstrap resolves before the queue query fires — no race
	// between create and read. This is the create/resume round-trip the loader
	// used to block SSR on; it now streams behind the Suspense spinner (B1).
	const { data: bootstrap } = useSuspenseQuery(
		matchReviewBootstrapQueryOptions(session.accountId, mode),
	);

	// Overlap the first card's authoritative present() capture with the queue read.
	// Bootstrap already created the session and reports firstUnresolvedItemId — the
	// exact card the stack lands on, computed server-side with the same predicate as
	// deriveUnresolvedIds — so warming its present query here lets that POST run
	// concurrently with the queue read instead of firing only once QueueCardContent
	// mounts and suspends, cutting the queue → present leg of the
	// bootstrap → queue → present waterfall. Seeding off firstUnresolvedItemId (not
	// itemIds[0]) means a resumed session with a resolved head still warms the right
	// card. Prefetch is fired during render (not an effect) on purpose: an effect runs
	// only after this component commits, which is gated on the queue suspend below, so
	// it would never overlap. Exactly one present is warmed — present captures visible
	// pairs, so we never speculate past the card a first render lands on — and it is
	// deduped by key with first-write-wins capture, so this component's re-renders
	// under job polling re-issue a cheap no-op.
	const firstItemId = bootstrap.firstUnresolvedItemId;
	if (firstItemId) {
		void queryClient.prefetchQuery(
			presentMatchReviewItemQueryOptions(firstItemId),
		);
	}

	const { data: queue } = useSuspenseQuery(
		matchReviewQueryOptions(session.accountId, mode),
	);

	// Ordered unresolved item ids derived from queue state — never from null song.
	// Shares deriveUnresolvedIds with the unit-tested helper so the route and its
	// contract can't drift: resolved items (completed/skipped/unavailable) are
	// excluded and the rest are position-sorted.
	const unresolvedIds = useMemo(() => deriveUnresolvedIds(queue), [queue]);

	// total reflects ALL queue items (append-only from the server).
	const total = queue?.total ?? 0;
	// caughtUp via the shared helper — authoritative server caughtUp OR an empty
	// unresolved list, never from null song data.
	const caughtUp = deriveCaughtUp(queue, unresolvedIds);
	const hasQueue = !!queue?.sessionId;
	// Review subjects whose only matches sit below the strictness bar — drives the
	// "loosen strictness" empty state over the "nothing surfaced" one. Orientation-
	// aware: songs in song mode, playlists in playlist mode.
	const hiddenReviewItemCount = queue?.hiddenReviewItemCount ?? 0;

	// Poll active jobs so the empty state can distinguish "still building" from
	// "truly empty". Shares the query cache entry with the layout's completion
	// effects hook — no extra fetches.
	const {
		isEnrichmentRunning,
		isMatchSnapshotRefreshRunning,
		firstVisibleMatchReady,
	} = useActiveJobs(session.accountId);
	const isJobsActive = isEnrichmentRunning || isMatchSnapshotRefreshRunning;

	// Latch: once this visit has had unresolved items to work, keep rendering the
	// session UI for the rest of the visit. Completing the last card invalidates the
	// queue query, and its refetch reports caughtUp — without this latch the parent
	// would tear the just-rendered CompletionScreen back down to an empty state
	// (the "quiet in here" flash). The session's own isComplete logic owns the
	// completion view; the empty state is only for arriving already caught up.
	const sessionStartedRef = useRef(false);
	if (!caughtUp) sessionStartedRef.current = true;

	const handleExit = useCallback(() => navigate({ to: "/" }), [navigate]);

	// Navigate to the canonical URL for the selected mode and persist preference.
	// Navigation commits immediately so the toggle stays responsive; the
	// preference write never blocks it. On a successful write we invalidate the
	// preference-driven summary + dashboard keys so the sidebar badge and Match
	// link reflect the new mode without waiting for staleTime. A write failure is
	// swallowed — navigation already committed and must not be undone.
	const handleModeChange = useCallback(
		(newMode: MatchViewMode) => {
			void navigate({
				to: "/match",
				search: newMode === "playlist" ? { mode: "playlist" } : {},
			});
			void setMatchViewModePreference({ data: { mode: newMode } })
				.then(() => {
					queryClient.invalidateQueries({
						queryKey: matchReviewSummaryKeys.preferredSummary(
							session.accountId,
						),
					});
					queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
				})
				.catch(() => {
					// Best-effort: the preference write failed but navigation already
					// committed, so there is nothing to roll back.
				});
		},
		[navigate, queryClient, session.accountId],
	);

	// Recovery bootstrap: the loader creates the session only on entry. A user who
	// opened /match before the first snapshot existed has no session, and once a
	// first visible match becomes ready nothing else would create it (background
	// refresh only syncs existing sessions). Re-run the one-shot bootstrap so the
	// now-ready queue mounts instead of stranding on the empty state. The helper
	// owns retry-with-backoff (a failed attempt must not dead-end on "building");
	// the AbortController stops it on unmount or when the stranded condition clears.
	useEffect(() => {
		if (!shouldBootstrapReadyQueue({ hasQueue, firstVisibleMatchReady }))
			return;
		const controller = new AbortController();
		void bootstrapReadyMatchQueue({
			mode,
			accountId: session.accountId,
			queryClient,
			signal: controller.signal,
		});
		return () => controller.abort();
	}, [hasQueue, firstVisibleMatchReady, mode, session.accountId, queryClient]);

	// No queue at all means no snapshot context yet. "no-context" (set a matching
	// intent) shows only for genuinely-no-setup users; a still-running setup — or a
	// ready match whose session the recovery effect above is creating — shows
	// "building" instead of the wrong prompt.
	if (!hasQueue) {
		const reason = deriveEmptyStateReason({
			hasQueue,
			caughtUp,
			isJobsActive,
			firstVisibleMatchReady,
			total,
			hiddenReviewItemCount,
		});
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={reason}
					mode={mode}
					onModeChange={handleModeChange}
				/>
			</div>
		);
	}

	// Queue exists but every item is resolved (deriveCaughtUp folds in the
	// empty-unresolved case). Three terminal states, in priority order:
	//  - hidden songs exist     → "filtered": loosen strictness to recover them
	//  - total === 0            → "none-yet": matching ran but surfaced nothing
	//  - otherwise              → "caught-up": worked through a real pile
	// Only show the empty state when arriving already caught up (no session worked
	// this visit). Mid-session completion is handled by QueueMatchContent's own
	// CompletionScreen, which the latch keeps mounted.
	if (caughtUp && !sessionStartedRef.current) {
		// Active-jobs states take priority — never show a terminal empty state
		// while enrichment or match-refresh is still running.
		const reason = deriveEmptyStateReason({
			hasQueue,
			caughtUp,
			isJobsActive,
			firstVisibleMatchReady,
			total,
			hiddenReviewItemCount,
		});
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={reason}
					hiddenCount={hiddenReviewItemCount}
					mode={mode}
					onModeChange={handleModeChange}
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			{/* key={mode} ensures visit-local state (pastItems, addedTo, sessionStats)
			    resets on mode switch within the same route mount boundary. */}
			<QueueMatchContent
				key={mode}
				accountId={session.accountId}
				mode={mode}
				itemIds={unresolvedIds}
				total={total}
				onExit={handleExit}
				onModeChange={handleModeChange}
				queryClient={queryClient}
			/>
		</div>
	);
}

interface QueueMatchContentProps {
	accountId: string;
	/** URL-backed orientation for this session — drives invalidation key scoping. */
	mode: MatchViewMode;
	itemIds: string[];
	total: number;
	onExit: () => void;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueMatchContent({
	accountId,
	mode,
	itemIds,
	total,
	onExit,
	onModeChange,
	queryClient,
}: QueueMatchContentProps) {
	const analytics = useAnalytics();

	// Track the current card by id, not by numeric offset. When a refetch drops
	// resolved items from the head of the list, indexOf(currentItemId) is still
	// stable — the card never jumps. null means caught-up / complete.
	const [currentItemId, setCurrentItemId] = useState<string | null>(
		() => itemIds[0] ?? null,
	);
	// Items resolved during this session that the server's queue snapshot hasn't
	// dropped yet. Removing them from navigation immediately (rather than waiting
	// for a refetch) stops Previous/Next from revisiting a card whose mutations
	// would now reject with already-resolved.
	const [locallyResolvedIds, setLocallyResolvedIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [addedTo, setAddedTo] = useState<string[]>([]);
	const [navigationStatus, setNavigationStatus] = useState<"idle" | "pending">(
		"idle",
	);
	// Ref so lock checks inside async handlers don't close over stale state.
	const navigationLockedRef = useRef(false);

	const [sessionStats, setSessionStats] = useState(() => ({
		addedCount: 0,
		dismissedCount: 0,
		skippedCount: 0,
		songsWithAdditions: new Set<string>(),
	}));

	const [pastItems, setPastItems] = useState<ReviewedItem[]>([]);

	// Passive chip: fire when queue.total grows. Using total (append-only from the
	// server) rather than itemIds.length means a head-drop + tail-append that nets
	// zero on length still surfaces the new-items notification.
	const prevTotalRef = useRef(total);
	useEffect(() => {
		const prev = prevTotalRef.current;
		prevTotalRef.current = total;

		const added = countAppendedFromTotal(prev, total);
		if (added > 0) {
			toast(`${added} new ${added === 1 ? "match" : "matches"} added`, {
				duration: 3000,
			});
		}
	}, [total]);

	// The list the UI actually navigates over: server-unresolved minus the items
	// resolved locally this session. This is the single source of truth for the
	// current card, navigation bounds, and Previous/Next.
	const effectiveItemIds = useMemo(
		() => itemIds.filter((id) => !locallyResolvedIds.has(id)),
		[itemIds, locallyResolvedIds],
	);

	// Prune locally-resolved ids the server has since dropped from its snapshot,
	// so the set can't grow without bound across appends/refetches.
	useEffect(() => {
		setLocallyResolvedIds((prev) => {
			if (prev.size === 0) return prev;
			const serverIds = new Set(itemIds);
			let changed = false;
			const next = new Set<string>();
			for (const id of prev) {
				if (serverIds.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : prev;
		});
	}, [itemIds]);

	// Advance off the just-resolved card without waiting for a network refetch:
	// compute the next card from the current effective list, then mark the card
	// resolved so it leaves navigation immediately.
	const handleResolveCurrentItem = useCallback(
		(resolvedId: string) => {
			setCurrentItemId(nextItemIdAfterResolved(effectiveItemIds, resolvedId));
			setLocallyResolvedIds((prev) => {
				const next = new Set(prev);
				next.add(resolvedId);
				return next;
			});
		},
		[effectiveItemIds],
	);

	// Resolve the stable current item: if the tracked id dropped from the unresolved
	// list (resolved externally) fall back to the first unresolved rather than crash.
	const resolvedCurrentId = resolveCurrentItemId(
		effectiveItemIds,
		currentItemId,
	);

	// currentIndex drives the X-of-Y display and prev/next bounds — both in the
	// unresolved domain so numerator and denominator are always consistent.
	const currentIndex =
		resolvedCurrentId !== null
			? effectiveItemIds.indexOf(resolvedCurrentId)
			: -1;

	const isComplete = resolvedCurrentId === null;

	// Refresh sidebar badge + queue summary on session exit, whether the user
	// completes all cards or navigates away mid-session. Scoped to the current
	// orientation so playlist-mode invalidation doesn't evict song-mode cache.
	const invalidateSessionBoundary = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: matchReviewSummaryKeys.summary(accountId, mode),
		});
		queryClient.invalidateQueries({
			queryKey: matchReviewKeys.review(accountId, mode),
		});
		queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
	}, [queryClient, accountId, mode]);

	const completionCapturedRef = useRef(false);
	useEffect(() => {
		if (!isComplete || completionCapturedRef.current) return;
		completionCapturedRef.current = true;
		analytics.capture("matching_session_completed", { total_songs: total });
		invalidateSessionBoundary();
	}, [isComplete, total, analytics, invalidateSessionBoundary]);

	// Cleanup effect: covers departure via sidebar nav or browser back.
	useEffect(
		() => () => {
			invalidateSessionBoundary();
		},
		[invalidateSessionBoundary],
	);

	// skippedCount is tracked explicitly (incremented when a card is finished with
	// no adds, or an unavailable card is skipped) rather than derived from
	// currentIndex. Once resolved cards are removed from effectiveItemIds, the
	// position-based derivation went negative on the first action and undercounted
	// skips.
	const completionStats: CompletionStats = useMemo(
		() => ({
			totalItems: total,
			itemsMatched: sessionStats.songsWithAdditions.size,
			totalAdditions: sessionStats.addedCount,
			dismissedCount: sessionStats.dismissedCount,
			skippedCount: sessionStats.skippedCount,
		}),
		[total, sessionStats],
	);

	// Stable identities so the child's release-on-mount effect runs exactly once
	// per card. Both only touch a ref + a stable setState, so empty deps are safe.
	const lockNavigation = useCallback(() => {
		if (navigationLockedRef.current) return false;
		navigationLockedRef.current = true;
		setNavigationStatus("pending");
		return true;
	}, []);
	const releaseNavigation = useCallback(() => {
		navigationLockedRef.current = false;
		setNavigationStatus("idle");
	}, []);

	if (isComplete || !resolvedCurrentId) {
		return (
			<Matching
				currentReviewItem={null}
				currentSuggestions={[]}
				totalSongs={total}
				offset={effectiveItemIds.length}
				addedTo={[]}
				isComplete={true}
				completionStats={completionStats}
				recentItems={pastItems}
				onAdd={() => {}}
				onDismiss={() => {}}
				onNext={() => {}}
				onExit={onExit}
			/>
		);
	}

	// Intentionally NOT keyed by item id. Keeping QueueCardContent mounted across
	// cards leaves the header chrome + entrance animation in place and lets the
	// song/matches panels run their AnimatePresence song-to-song slide (a keyed
	// remount would instead replay the whole-page entrance on every advance and
	// leave the panels with no exit). itemId flows in as a prop; the effects below
	// re-run on itemId change.
	return (
		<QueueCardContent
			itemId={resolvedCurrentId}
			currentIndex={currentIndex}
			total={total}
			mode={mode}
			unresolvedIds={effectiveItemIds}
			addedTo={addedTo}
			navigationStatus={navigationStatus}
			pastItems={pastItems}
			completionStats={completionStats}
			onAddedTo={setAddedTo}
			onSessionStats={setSessionStats}
			onPastItems={setPastItems}
			onCurrentItemId={setCurrentItemId}
			onResolveCurrentItem={handleResolveCurrentItem}
			onLockNavigation={lockNavigation}
			onReleaseNavigation={releaseNavigation}
			onModeChange={onModeChange}
			onExit={onExit}
			analytics={analytics}
			queryClient={queryClient}
		/>
	);
}

// Header for the non-ready cards (unavailable / retryable-error). Mirrors the
// ready card's "Matching / X of Y" heading but pairs it with the orientation
// toggle so a user stuck on one of these states can still switch modes (A2)
// instead of being stranded. No progress bar — these cards aren't a live
// position in the walk.
function NonReadyCardHeader({
	progressIndex,
	total,
	mode,
	disabled,
	onModeChange,
}: {
	progressIndex: number;
	total: number;
	mode: MatchViewMode;
	disabled: boolean;
	onModeChange: (mode: MatchViewMode) => void;
}) {
	return (
		<div className="mb-12 flex items-end justify-between gap-6">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Matching
				</p>
				<h2
					className="theme-text mt-3 text-3xl font-extralight tabular-nums leading-none"
					style={{ fontFamily: fonts.display }}
				>
					<span>{progressIndex + 1}</span>
					<span className="theme-text-muted opacity-60"> / {total}</span>
				</h2>
			</div>
			<MatchModeToggle
				mode={mode}
				disabled={disabled}
				onModeChange={onModeChange}
			/>
		</div>
	);
}

interface QueueCardContentProps {
	itemId: string;
	currentIndex: number;
	// Full session size (queue.total, append-only). The progress header's
	// denominator, distinct from currentIndex/unresolvedIds which live in the
	// shrinking navigable domain.
	total: number;
	/** URL-backed orientation for this session — forwarded to the header toggle. */
	mode: MatchViewMode;
	unresolvedIds: string[];
	addedTo: string[];
	navigationStatus: "idle" | "pending";
	pastItems: ReviewedItem[];
	completionStats: CompletionStats;
	onAddedTo: React.Dispatch<React.SetStateAction<string[]>>;
	onSessionStats: React.Dispatch<
		React.SetStateAction<{
			addedCount: number;
			dismissedCount: number;
			skippedCount: number;
			songsWithAdditions: Set<string>;
		}>
	>;
	onPastItems: React.Dispatch<React.SetStateAction<ReviewedItem[]>>;
	onCurrentItemId: React.Dispatch<React.SetStateAction<string | null>>;
	// Marks the current card resolved locally and advances to the next unresolved
	// card. Use after a successful finish/dismiss/skip so a resolved card cannot be
	// revisited via Previous before the server snapshot catches up.
	onResolveCurrentItem: (resolvedId: string) => void;
	onLockNavigation: () => boolean;
	onReleaseNavigation: () => void;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	onExit: () => void;
	analytics: ReturnType<typeof useAnalytics>;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueCardContent({
	itemId,
	currentIndex,
	total,
	mode,
	unresolvedIds,
	addedTo,
	navigationStatus,
	pastItems,
	completionStats,
	onAddedTo,
	onSessionStats,
	onPastItems,
	onCurrentItemId,
	onResolveCurrentItem,
	onLockNavigation,
	onReleaseNavigation,
	onModeChange,
	onExit,
	analytics,
	queryClient,
}: QueueCardContentProps) {
	// Authoritative card render: reads from captured pair rows (MSR-25) via the
	// present (POST) capture path — the same query the first-card seed and the
	// next-card prefetch warm, so an advance renders from cache instead of suspending.
	const { data: itemData } = useSuspenseQuery(
		presentMatchReviewItemQueryOptions(itemId),
	);

	// Durable presented tracking: fire once per item when it becomes current and
	// the read resolved to a card the user actually sees. Both "ready" and
	// "unavailable" render a card in front of the user, so both mark presented and
	// clear newness; "error" is excluded because ownership/data integrity is
	// unknown. Newness is cleared durably and immediately, not at unload. A ref-set
	// ensures we fire at most once per item even under StrictMode.
	const presentedIdsRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (itemData.status !== "ready" && itemData.status !== "unavailable")
			return;
		if (presentedIdsRef.current.has(itemId)) return;
		presentedIdsRef.current.add(itemId);
		void markMatchReviewItemPresented({ data: { itemId } });
	}, [itemId, itemData.status]);

	// Prefetch the next card's authoritative present query so a forward advance
	// renders from cache instead of suspending (B2). Warming must target the present
	// key the card actually reads — warming any other key leaves present uncached and
	// every advance suspends (worst in playlist mode). Only next1 is warmed: present
	// captures visible pairs and marks the item active, so we speculate exactly one
	// card ahead — the one a forward advance lands on — and re-warm the new next1 on
	// each advance.
	useEffect(() => {
		const next1 = unresolvedIds[currentIndex + 1];
		if (next1) {
			queryClient.prefetchQuery(presentMatchReviewItemQueryOptions(next1));
		}
	}, [queryClient, currentIndex, unresolvedIds]);

	// QueueCardContent now persists across cards (see the render site — it is not
	// keyed), so this no longer runs on a fresh mount per card. The previous card's
	// successful action leaves navigation locked (status "pending"); re-running on
	// itemId change clears the lock once we land on the next card. onReleaseNavigation
	// is stable (useCallback), so itemId is the only trigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: itemId is an intentional re-sync trigger, not a value read in the body — the lock must release when the current card changes, mirroring the old release-on-mount behavior.
	useEffect(() => {
		onReleaseNavigation();
	}, [itemId, onReleaseNavigation]);

	// Map server shape → orientation-aware union types.
	const currentReviewItem: MatchingReviewItem | null = (() => {
		if (itemData.status !== "ready") return null;
		if (itemData.mode === "song") {
			return {
				mode: "song" as const,
				song: {
					id: itemData.reviewItem.id,
					spotifyId: itemData.reviewItem.spotifyId,
					name: itemData.reviewItem.name,
					artist: itemData.reviewItem.artist,
					album: itemData.reviewItem.album ?? null,
					albumArtUrl: itemData.reviewItem.albumArtUrl,
					genres: itemData.reviewItem.genres,
					audioFeatures: itemData.reviewItem.audioFeatures ?? null,
					analysis: itemData.reviewItem.analysis ?? null,
				},
			};
		}
		return {
			mode: "playlist" as const,
			playlist: {
				id: itemData.reviewItem.id,
				spotifyId: itemData.reviewItem.spotifyId,
				name: itemData.reviewItem.name,
				description: itemData.reviewItem.description,
				imageUrl: itemData.reviewItem.imageUrl,
				trackCount: itemData.reviewItem.trackCount,
			},
		};
	})();

	const currentSuggestions: MatchingSuggestion[] =
		useMemo((): MatchingSuggestion[] => {
			if (itemData.status !== "ready") return [];
			if (itemData.mode === "song") {
				return itemData.suggestions.map((m) => ({
					mode: "song" as const,
					playlist: {
						id: m.playlist.id,
						spotifyId: m.playlist.spotifyId,
						name: m.playlist.name,
						reason: m.playlist.description ?? "",
						matchScore: m.score,
						imageUrl: m.playlist.imageUrl,
						songCount: m.playlist.trackCount,
					},
				}));
			}
			return itemData.suggestions.map((s) => ({
				mode: "playlist" as const,
				song: {
					id: s.song.id,
					spotifyId: s.song.spotifyId,
					name: s.song.name,
					artist: s.song.artist,
					album: s.song.album ?? null,
					albumArtUrl: s.song.albumArtUrl,
					genres: s.song.genres,
					audioFeatures: s.song.audioFeatures ?? null,
					analysis: s.song.analysis ?? null,
				},
				fitScore: s.fitScore,
			}));
		}, [itemData]);

	// Narrow helpers — each is null when the other orientation is active.
	const currentSong =
		currentReviewItem?.mode === "song" ? currentReviewItem.song : null;
	const currentPlaylist =
		currentReviewItem?.mode === "playlist" ? currentReviewItem.playlist : null;

	const songId =
		currentReviewItem?.mode === "song" ? currentReviewItem.song.id : "";
	const { reconnectNeeded, setReconnectNeeded } =
		useSpotifyReconnectState(songId);

	// Header progress: position within the whole session, NOT within the shrinking
	// navigable list. Resolved cards drop out of unresolvedIds, so currentIndex is
	// always ~0 (the current card is the head of what's left); using it as the
	// numerator pinned the display at 1/N and made N count down as cards resolved.
	// total − remaining advances the numerator instead.
	const progressIndex = deriveProgressIndex(total, unresolvedIds.length);

	// Unavailable card: the item cannot be shown. The body copy is the server's
	// real `message` for the specific `reason` (not-entitled, missing-song,
	// snapshot-not-owned, already-resolved, no-visible-suggestions) — the old
	// code re-derived a "no longer available" string from the URL mode, which was
	// wrong for the no-visible-suggestions reason (A1). Skip resolves the card via
	// finishMatchReviewItem (marks it resolved/skipped). When the subject only has
	// matches hidden under the strictness bar (no-visible-suggestions), a
	// recoverable "loosen strictness" link is the primary affordance instead.
	if (itemData.status === "unavailable") {
		const loosenStrictness = shouldOfferLoosenStrictness(itemData.reason);
		const skipLabel = mode === "playlist" ? "Skip Playlist" : "Skip Song";

		const handleSkipUnavailable = async () => {
			if (!onLockNavigation()) return;
			try {
				const result = await finishMatchReviewItem({ data: { itemId } });

				if (!result.success) {
					// Server rejected the finish (e.g. no_captured_pairs) — do NOT
					// advance. Releasing the lock lets the user retry rather than skipping
					// past a card the server still considers unresolved.
					onReleaseNavigation();
					return;
				}

				// An unavailable card the user moves past is a skip.
				onSessionStats((prev) => ({
					...prev,
					skippedCount: prev.skippedCount + 1,
				}));
				// Resolve locally + advance so the unavailable card leaves navigation.
				onResolveCurrentItem(itemId);
			} catch {
				onReleaseNavigation();
			}
		};

		return (
			<div>
				<NonReadyCardHeader
					progressIndex={progressIndex}
					total={total}
					mode={mode}
					disabled={navigationStatus === "pending"}
					onModeChange={onModeChange}
				/>
				<div
					className="theme-surface-bg theme-border-color flex flex-col items-start gap-4 border p-6"
					role="status"
					aria-label={
						loosenStrictness
							? "No matches visible"
							: mode === "playlist"
								? "Playlist unavailable"
								: "Song unavailable"
					}
				>
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						{itemData.message}
					</p>
					<div className="flex flex-wrap items-center gap-6">
						{loosenStrictness && (
							<Link
								to="/settings"
								hash="settings-section-matching"
								search={{ from: "match" }}
								className="theme-primary text-sm font-medium tracking-wide"
								style={{ fontFamily: fonts.body }}
							>
								Adjust strictness →
							</Link>
						)}
						<button
							type="button"
							onClick={handleSkipUnavailable}
							className={`text-sm font-medium tracking-wide ${
								loosenStrictness ? "theme-text-muted" : "theme-primary"
							}`}
							style={{ fontFamily: fonts.body }}
							disabled={navigationStatus === "pending"}
						>
							{skipLabel} →
						</button>
					</div>
				</div>
			</div>
		);
	}

	// Retryable-error card: a transient fetch failure. H7 copy is generic (not
	// mode-specific — the error is about loading the card, not the review item).
	// "Try again" refetches the authoritative present query without resolving the
	// item — retryable errors must never silently skip the card.
	if (itemData.status === "retryable-error") {
		const handleRetry = () => {
			queryClient.invalidateQueries({
				queryKey: presentMatchReviewItemQueryOptions(itemId).queryKey,
			});
		};

		return (
			<div>
				<NonReadyCardHeader
					progressIndex={progressIndex}
					total={total}
					mode={mode}
					disabled={navigationStatus === "pending"}
					onModeChange={onModeChange}
				/>
				<div
					className="theme-surface-bg theme-border-color flex flex-col items-start gap-4 border p-6"
					role="status"
					aria-label="Card load error"
				>
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						Couldn't load this match card. Try again.
					</p>
					<button
						type="button"
						onClick={handleRetry}
						className="theme-primary text-sm font-medium tracking-wide"
						style={{ fontFamily: fonts.body }}
					>
						Try again
					</button>
				</div>
			</div>
		);
	}

	const recordCurrentItem = () => {
		if (!currentReviewItem) return;
		const item =
			currentReviewItem.mode === "song"
				? {
						id: currentReviewItem.song.id,
						albumArtUrl: currentReviewItem.song.albumArtUrl,
						name: currentReviewItem.song.name,
						artist: currentReviewItem.song.artist,
					}
				: {
						id: currentReviewItem.playlist.id,
						albumArtUrl: currentReviewItem.playlist.imageUrl,
						name: currentReviewItem.playlist.name,
						artist: "",
					};
		onPastItems((prev) => {
			if (prev.some((s) => s.id === item.id)) return prev;
			return [...prev, item];
		});
	};

	const handleAdd = async (suggestionId: string) => {
		// Add does NOT advance the card — user may add to multiple suggestions.
		// It still locks navigation while the add decision is in flight so Finish or
		// Dismiss cannot resolve the item before the add row exists.
		if (!currentReviewItem || !onLockNavigation()) return;
		try {
			setReconnectNeeded(false);

			if (currentReviewItem.mode === "song") {
				// Song mode: suggestionId is a playlist id; add the review song to that playlist.
				const currentMatches = currentSuggestions
					.filter(
						(s): s is Extract<MatchingSuggestion, { mode: "song" }> =>
							s.mode === "song",
					)
					.map((s) => s.playlist);

				const playlist = currentMatches.find((p) => p.id === suggestionId);

				if (playlist?.spotifyId && currentSong?.spotifyId) {
					const result = await addToPlaylist(
						`spotify:playlist:${playlist.spotifyId}`,
						[`spotify:track:${currentSong.spotifyId}`],
					);
					const outcome = outcomeFromCommandResponse(result);
					if (outcome.status === "reconnect-required") {
						setReconnectNeeded(true);
						return;
					}
					if (outcome.status === "error") return;
				}

				const addResult = await addSongToPlaylistFromQueueItem({
					data: { itemId, suggestionId },
				});

				if (!addResult.success) return;

				analytics.capture("song_added_to_playlist", {
					song_id: currentSong?.id,
					playlist_id: suggestionId,
					playlist_name: playlist?.name,
					orientation: "song",
				});

				onAddedTo((prev) => [...prev, suggestionId]);
				onSessionStats((prev) => {
					const next = new Set(prev.songsWithAdditions);
					if (currentSong?.id) next.add(currentSong.id);
					return {
						...prev,
						addedCount: prev.addedCount + 1,
						songsWithAdditions: next,
					};
				});
			} else {
				// Playlist mode: suggestionId is a song id; add that song to the review playlist.
				const songSuggestions = currentSuggestions
					.filter(
						(s): s is Extract<MatchingSuggestion, { mode: "playlist" }> =>
							s.mode === "playlist",
					)
					.map((s) => s.song);

				const suggestionSong = songSuggestions.find(
					(s) => s.id === suggestionId,
				);

				if (currentPlaylist?.spotifyId && suggestionSong?.spotifyId) {
					const result = await addToPlaylist(
						`spotify:playlist:${currentPlaylist.spotifyId}`,
						[`spotify:track:${suggestionSong.spotifyId}`],
					);
					const outcome = outcomeFromCommandResponse(result);
					if (outcome.status === "reconnect-required") {
						setReconnectNeeded(true);
						return;
					}
					if (outcome.status === "error") return;
				}

				const addResult = await addSongToPlaylistFromQueueItem({
					data: { itemId, suggestionId },
				});

				if (!addResult.success) return;

				analytics.capture("song_added_to_playlist", {
					song_id: suggestionId,
					playlist_id: currentPlaylist?.id,
					playlist_name: currentPlaylist?.name,
					orientation: "playlist",
				});

				onAddedTo((prev) => [...prev, suggestionId]);
				onSessionStats((prev) => {
					const next = new Set(prev.songsWithAdditions);
					// Track the review playlist as the matched review item (E12 generalization).
					if (currentPlaylist?.id) next.add(currentPlaylist.id);
					return {
						...prev,
						addedCount: prev.addedCount + 1,
						songsWithAdditions: next,
					};
				});
			}
		} finally {
			onReleaseNavigation();
		}
	};

	const handleDismiss = async () => {
		if (!currentReviewItem || !onLockNavigation()) return;
		try {
			recordCurrentItem();
			if (currentReviewItem.mode === "song") {
				analytics.capture("song_dismissed", {
					song_id: currentReviewItem.song.id,
				});
			}

			const result = await dismissMatchReviewItem({ data: { itemId } });

			if (!result.success) {
				// derive-failed or not-found: do NOT advance the card. Releasing the
				// lock lets the user retry rather than silently swallowing the error.
				onReleaseNavigation();
				return;
			}

			onSessionStats((prev) => ({
				...prev,
				dismissedCount: prev.dismissedCount + 1,
			}));
			onAddedTo([]);
			// Resolve locally + advance; the card leaves navigation immediately so
			// Previous cannot return to it before the server snapshot catches up.
			onResolveCurrentItem(itemId);
		} catch {
			onReleaseNavigation();
		}
	};

	const handleNext = async () => {
		if (!currentReviewItem || !onLockNavigation()) return;
		try {
			recordCurrentItem();
			const result = await finishMatchReviewItem({ data: { itemId } });

			if (!result.success) {
				// Server rejected the finish (e.g. already resolved) — do NOT advance.
				// Releasing the lock lets the user retry without losing their place.
				onReleaseNavigation();
				return;
			}

			// Finishing a card with no adds is a skip; with adds it's a match (already
			// counted via songsWithAdditions on each add). Check before clearing addedTo.
			if (addedTo.length === 0) {
				onSessionStats((prev) => ({
					...prev,
					skippedCount: prev.skippedCount + 1,
				}));
			}
			onAddedTo([]);
			// Resolve locally + advance; the card leaves navigation immediately so
			// Previous cannot return to it before the server snapshot catches up.
			onResolveCurrentItem(itemId);
		} catch {
			onReleaseNavigation();
		}
	};

	const handlePrevious = () => {
		if (currentIndex === 0 || !onLockNavigation()) return;
		onAddedTo([]);
		// Best-effort: go back to the previous unresolved item. If it was resolved
		// externally since we last saw it, resolveCurrentItemId will fall back safely.
		onCurrentItemId(unresolvedIds[currentIndex - 1] ?? null);
	};

	// X-of-Y is session progress, not a position in the navigable list: offset is
	// total − remaining so the numerator climbs (1 → 2 → 3) as cards resolve, while
	// totalSongs stays at the full session size. The denominator still grows softly
	// as new matches append, which is the intended "N new matches" behavior. Prev/Next
	// bounds stay in the navigable domain via currentIndex below.
	return (
		<Matching
			currentReviewItem={currentReviewItem}
			currentSuggestions={currentSuggestions}
			totalSongs={total}
			offset={progressIndex}
			addedTo={addedTo}
			isComplete={false}
			completionStats={completionStats}
			recentItems={pastItems}
			reconnectNeeded={reconnectNeeded}
			navigationDisabled={navigationStatus === "pending"}
			mode={mode}
			onModeChange={onModeChange}
			onAdd={handleAdd}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onPrevious={currentIndex > 0 ? handlePrevious : undefined}
			onExit={onExit}
		/>
	);
}
