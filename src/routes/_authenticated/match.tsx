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
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { MatchModeToggle } from "@/features/matching/components/MatchModeToggle";
import { isDeckActionSuccess } from "@/features/matching/deck-action-status";
import {
	matchDeckKeys,
	matchDeckQueryOptions,
	readMatchDeckCardQueryOptions,
} from "@/features/matching/deck-queries";
import { Matching } from "@/features/matching/Matching";
import {
	hasNonCanonicalMatchMode,
	modeFromSearch,
	validateMatchSearch,
} from "@/features/matching/match-search";
import { matchReviewSummaryKeys } from "@/features/matching/queries";
import {
	countAppendedFromTotal,
	deriveEmptyStateReason,
	deriveProgressIndex,
	resolveCurrentItemId,
	shouldOfferLoosenStrictness,
} from "@/features/matching/queue-helpers";
import type {
	CompletionStats,
	MatchingSuggestion,
	MatchViewMode,
	ReviewedItem,
} from "@/features/matching/types";
import { useMatchReviewCard } from "@/features/matching/useMatchReviewCard";
import { WalkthroughMatchContent } from "@/features/matching/WalkthroughMatchContent";
import { sessionMode } from "@/lib/domains/library/accounts/onboarding-session";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { captureRouteError } from "@/lib/observability/sentry";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import {
	type MatchDeckView,
	type StartOrResumeMatchDeckResult,
	submitMatchDeckAction,
} from "@/lib/server/match-deck.functions";
import { setMatchViewModePreference } from "@/lib/server/settings.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/match")({
	// `mode=playlist` is non-canonical (A3) — `/match` is the canonical playlist-mode URL.
	// Any non-`song` mode value in the URL is replaced with the bare `/match`
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
	// The deck read is keyed per orientation, so the loader must depend on the
	// URL mode — a mode switch re-runs the loader for the other orientation.
	loaderDeps: ({ search }) => ({ mode: modeFromSearch(search) }),
	// /_authenticated already resolved the session via resolveSession. The deck
	// read model makes every start/resume path bounded (plan §8), so the loader
	// awaits it again: it seeds `matchDeckQueryOptions` (and the two baked cards)
	// so QueueMatchPage renders card #1 with no client-side bootstrap → queue →
	// present waterfall (RB). Cold SSR + the rare miss-path build stream behind
	// `pendingComponent: MatchLoading`. Walkthrough modes have no deck (the DU
	// guarantees song presence), so they short-circuit before the read.
	loader: async ({ context, deps }) => {
		if (sessionMode(context.onboardingSession) === "walkthrough") return;

		const { queryClient, session } = context;
		const view = await queryClient.ensureQueryData(
			matchDeckQueryOptions(session.accountId, deps.mode),
		);

		// Seed the current + next card reads so the first render (and a one-step
		// advance) resolve from cache instead of re-fetching. The building state
		// (`{status:"building"}`) has no `itemIds`/cards to seed.
		if ("itemIds" in view) {
			for (const card of [view.cards.current, view.cards.next]) {
				if (card) {
					queryClient.setQueryData(
						readMatchDeckCardQueryOptions(card.itemId).queryKey,
						card.presentation,
					);
				}
			}
		}
	},
	errorComponent: MatchErrorComponent,
	pendingComponent: MatchLoading,
	component: MatchPage,
});

// Route pendingComponent (RB): streamed while the loader awaits the bounded deck
// read on cold SSR or during the rare miss-path first-window build. Also the
// inner Suspense fallback for a navigation that lands on a not-yet-seeded card.
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

// Catches a failed deck read (thrown by the loader or the client Suspense
// queries) so it renders a retry inside the app shell rather than bubbling to
// the full-page _authenticated error fallback. resetQueries clears the errored
// deck caches so `reset()` re-mounts into a fresh fetch.
function MatchErrorComponent({ error, reset }: ErrorComponentProps) {
	const queryClient = useQueryClient();

	useEffect(() => {
		captureRouteError(error, { route: "_authenticated/match" });
	}, [error]);

	const handleRetry = () => {
		queryClient.resetQueries({ queryKey: matchDeckKeys.all });
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

	// The loader seeds the deck query, so QueueMatchPage's useSuspenseQuery
	// resolves from cache; this boundary only re-engages when a Previous/Next
	// navigation lands on a card the loader/action didn't bake in.
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
	// Read mode from validated URL search. The loader seeded the deck query under
	// the matching (account, orientation) key.
	const mode = modeFromSearch(Route.useSearch());

	// ONE read: the whole page renders from the deck view (or the building state).
	const { data: view } = useSuspenseQuery(
		matchDeckQueryOptions(session.accountId, mode),
	);

	// Poll active jobs so the empty/building states can distinguish "still
	// building" from "truly empty". Shares the cache entry with the layout's
	// completion-effects hook — no extra fetches.
	const {
		isEnrichmentRunning,
		isMatchSnapshotRefreshRunning,
		firstVisibleMatchReady,
	} = useActiveJobs(session.accountId);
	const isJobsActive = isEnrichmentRunning || isMatchSnapshotRefreshRunning;

	const isBuilding = !("itemIds" in view);

	// Building-state recovery (RC): a first-run user who opened /match before any
	// proposal existed gets `{status:"building"}` and no session. Once a first
	// visible match becomes ready, re-run the bounded deck read — its miss path
	// promotes the first window and returns an active view. Without this the user
	// strands on "building". Replaces bootstrapReadyMatchQueue.
	useEffect(() => {
		if (!isBuilding || !firstVisibleMatchReady) return;
		queryClient.invalidateQueries({
			queryKey: matchDeckKeys.deck(session.accountId, mode),
		});
	}, [
		isBuilding,
		firstVisibleMatchReady,
		session.accountId,
		mode,
		queryClient,
	]);

	// Latch: once this visit has had a current card to work, keep rendering the
	// session UI for the rest of the visit. A completing action refetches the deck
	// query, and its refetch reports caughtUp — without this latch the parent would
	// tear the just-rendered CompletionScreen back down to an empty state (the
	// "quiet in here" flash). QueueMatchContent's own isComplete owns the
	// completion view; the empty state is only for arriving already caught up.
	const sessionStartedRef = useRef(false);

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
				search: newMode === "song" ? { mode: "song" } : {},
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

	// Building: no deck yet. Route the state through deriveEmptyStateReason (RD)
	// + useActiveJobs so a genuinely-no-setup user gets the "no-context" (set a
	// matching intent) CTA, while a still-running setup — or a ready match the RC
	// effect above is recovering — shows "building" instead of the wrong prompt.
	if (!("itemIds" in view)) {
		const reason = deriveEmptyStateReason({
			hasQueue: false,
			caughtUp: false,
			isJobsActive,
			firstVisibleMatchReady,
			total: 0,
			hiddenReviewItemCount: 0,
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

	// Caught-up: the deck reports no current card (cards.current === null folds in
	// the empty-unresolved case). Only show the empty state when arriving already
	// caught up (no session worked this visit); mid-session completion is handled
	// by QueueMatchContent's own CompletionScreen, which the latch keeps mounted.
	const caughtUp = view.progress.caughtUp || view.cards.current === null;
	if (!caughtUp) sessionStartedRef.current = true;

	if (caughtUp && !sessionStartedRef.current) {
		// Active-jobs states take priority — never show a terminal empty state
		// while enrichment or match-refresh is still running.
		const reason = deriveEmptyStateReason({
			hasQueue: true,
			caughtUp: true,
			isJobsActive,
			firstVisibleMatchReady,
			total: view.progress.total,
			hiddenReviewItemCount: view.progress.hiddenReviewItemCount,
		});
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={reason}
					hiddenCount={view.progress.hiddenReviewItemCount}
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
				view={view}
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
	/** The active deck view — its itemIds are the navigable timeline. */
	view: MatchDeckView;
	onExit: () => void;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueMatchContent({
	accountId,
	mode,
	view,
	onExit,
	onModeChange,
	queryClient,
}: QueueMatchContentProps) {
	const analytics = useAnalytics();

	// The deck view is the single source of truth for navigation: server-ordered
	// unresolved item ids (append-only total for the progress denominator). No
	// local locallyResolvedIds/effectiveItemIds reconciliation — a whole-card
	// action returns the fresh view (applied to the deck cache) and moves the
	// pointer, so the server is authoritative after every action.
	const itemIds = view.itemIds;
	const total = view.progress.total;

	// Track the current card by id, not by numeric offset. When an action drops
	// the resolved item from the head of the list, indexOf(currentItemId) is still
	// stable — the card never jumps (RG). null means caught-up / complete.
	const [currentItemId, setCurrentItemId] = useState<string | null>(
		() => view.cards.current?.itemId ?? itemIds[0] ?? null,
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

	// Passive chip: fire when the deck total grows. Using total (append-only from
	// the server) rather than itemIds.length means a head-drop + tail-append that
	// nets zero on length still surfaces the new-items notification.
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

	// Resolve the stable current item: if the tracked id dropped from the deck's
	// unresolved list (resolved via an action) fall back to the first unresolved
	// rather than crash.
	const resolvedCurrentId = resolveCurrentItemId(itemIds, currentItemId);

	// currentIndex drives the X-of-Y display and prev/next bounds — both in the
	// unresolved domain so numerator and denominator are always consistent.
	const currentIndex =
		resolvedCurrentId !== null ? itemIds.indexOf(resolvedCurrentId) : -1;

	const isComplete = resolvedCurrentId === null;

	// Refresh sidebar badge + deck read on session exit, whether the user
	// completes all cards or navigates away mid-session. Scoped to the current
	// orientation so playlist-mode invalidation doesn't evict song-mode cache.
	const invalidateSessionBoundary = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: matchDeckKeys.deck(accountId, mode),
		});
		queryClient.invalidateQueries({
			queryKey: matchReviewSummaryKeys.summary(accountId, mode),
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
	// currentIndex. Once resolved cards leave itemIds, the position-based
	// derivation went negative on the first action and undercounted skips.
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
				offset={itemIds.length}
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
			accountId={accountId}
			itemId={resolvedCurrentId}
			currentIndex={currentIndex}
			total={total}
			mode={mode}
			unresolvedIds={itemIds}
			addedTo={addedTo}
			navigationStatus={navigationStatus}
			pastItems={pastItems}
			completionStats={completionStats}
			onAddedTo={setAddedTo}
			onSessionStats={setSessionStats}
			onPastItems={setPastItems}
			onCurrentItemId={setCurrentItemId}
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
	/** Deck orientation owner — scopes the deck cache key applied after actions. */
	accountId: string;
	itemId: string;
	currentIndex: number;
	// Full session size (deck progress.total, append-only). The progress header's
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
	onLockNavigation: () => boolean;
	onReleaseNavigation: () => void;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	onExit: () => void;
	analytics: ReturnType<typeof useAnalytics>;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueCardContent({
	accountId,
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
	onLockNavigation,
	onReleaseNavigation,
	onModeChange,
	onExit,
	analytics,
	queryClient,
}: QueueCardContentProps) {
	// Authoritative card render: a pure read over captured pair rows (plan §7).
	// The loader seeded current+next and a whole-card action seeds the promoted
	// cards, so an advance renders from cache instead of suspending; a browse to a
	// further card reads it on demand (no capture side effect — RE).
	const { data: itemData } = useSuspenseQuery(
		readMatchDeckCardQueryOptions(itemId),
	);

	// Warm the next card's read query so a forward advance renders from cache
	// instead of suspending. Only next1 is warmed — one card ahead, the card a
	// forward Previous/Next lands on — and it dedupes with the cache the action
	// seeding already populated.
	useEffect(() => {
		const next1 = unresolvedIds[currentIndex + 1];
		if (next1) {
			queryClient.prefetchQuery(readMatchDeckCardQueryOptions(next1));
		}
	}, [queryClient, currentIndex, unresolvedIds]);

	// QueueCardContent persists across cards (see the render site — it is not
	// keyed), so this no longer runs on a fresh mount per card. The previous card's
	// successful action leaves navigation locked (status "pending"); re-running on
	// itemId change clears the lock once we land on the next card. onReleaseNavigation
	// is stable (useCallback), so itemId is the only trigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: itemId is an intentional re-sync trigger, not a value read in the body — the lock must release when the current card changes, mirroring the old release-on-mount behavior.
	useEffect(() => {
		onReleaseNavigation();
	}, [itemId, onReleaseNavigation]);

	// Present-card mapping, tail paging, and suggestion-dismiss cache behavior
	// are owned by the hook (Deepening #2 tracer bullet) — this component stays
	// responsible for navigation/session concerns only.
	const {
		currentReviewItem,
		currentSuggestions,
		suggestionTotal,
		hasMoreSuggestions,
		isLoadingMoreSuggestions,
		loadMoreSuggestions,
		loadMoreError,
		retryLoadMore,
		dismissSuggestion,
		waitForPendingDismisses,
	} = useMatchReviewCard({ itemId, itemData, queryClient });

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

	// Applies a whole-card action's returned deck view (RF): the server already
	// advanced the deck in-txn, so the fresh view carries the promoted current +
	// next cards. Seed both card reads (so the advance renders from cache), write
	// the view into the deck cache (so the parent re-renders over the new itemIds),
	// then move the id pointer to the promoted current — null when caught up.
	const applyResolvedView = (nextView: StartOrResumeMatchDeckResult) => {
		queryClient.setQueryData(
			matchDeckQueryOptions(accountId, mode).queryKey,
			nextView,
		);
		if (!("itemIds" in nextView)) {
			onCurrentItemId(null);
			return;
		}
		for (const card of [nextView.cards.current, nextView.cards.next]) {
			if (card) {
				queryClient.setQueryData(
					readMatchDeckCardQueryOptions(card.itemId).queryKey,
					card.presentation,
				);
			}
		}
		onCurrentItemId(
			nextView.cards.current?.itemId ?? nextView.itemIds[0] ?? null,
		);
	};

	// Unavailable card: the item cannot be shown. The body copy is the server's
	// real `message` for the specific `reason` (not-entitled, missing-song,
	// snapshot-not-owned, already-resolved, no-visible-suggestions) — the old
	// code re-derived a "no longer available" string from the URL mode, which was
	// wrong for the no-visible-suggestions reason (A1). Skip resolves the card via
	// finish-card. When the subject only has matches hidden under the strictness
	// bar (no-visible-suggestions), a recoverable "loosen strictness" link is the
	// primary affordance instead.
	if (itemData.status === "unavailable") {
		const loosenStrictness = shouldOfferLoosenStrictness(itemData.reason);
		const skipLabel = mode === "playlist" ? "Skip Playlist" : "Skip Song";

		const handleSkipUnavailable = async () => {
			if (!onLockNavigation()) return;
			try {
				const result = await submitMatchDeckAction({
					data: { type: "finish-card", itemId },
				});

				if (!isDeckActionSuccess("finish-card", result.actionStatus)) {
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
				// Advance to the deck's promoted next card; the unavailable card leaves
				// navigation because the server dropped it from itemIds.
				applyResolvedView(result.view);
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
	// "Try again" refetches the authoritative card read without resolving the
	// item — retryable errors must never silently skip the card.
	if (itemData.status === "retryable-error") {
		const handleRetry = () => {
			queryClient.invalidateQueries({
				queryKey: readMatchDeckCardQueryOptions(itemId).queryKey,
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

				const addResult = await submitMatchDeckAction({
					data: { type: "add-suggestion", itemId, suggestionId },
				});

				if (!isDeckActionSuccess("add-suggestion", addResult.actionStatus)) {
					return;
				}

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

				const addResult = await submitMatchDeckAction({
					data: { type: "add-suggestion", itemId, suggestionId },
				});

				if (!isDeckActionSuccess("add-suggestion", addResult.actionStatus)) {
					return;
				}

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

	// No navigation lock here: the mutation's optimistic removal (+ rollback on
	// failure) is the interaction feedback, unlike add/whole-card dismiss/finish
	// which advance the card and must serialize against Previous/Next.
	const handleDismissSuggestion = async (suggestionId: string) => {
		if (!currentReviewItem) return;
		const success = await dismissSuggestion(suggestionId);
		if (!success) return;

		analytics.capture("match_suggestion_dismissed", {
			orientation: currentReviewItem.mode,
			suggestion_id: suggestionId,
		});
	};

	const handleDismiss = async () => {
		if (!currentReviewItem || !onLockNavigation()) return;
		try {
			await waitForPendingDismisses();
			recordCurrentItem();
			if (currentReviewItem.mode === "song") {
				analytics.capture("song_dismissed", {
					song_id: currentReviewItem.song.id,
				});
			}

			const result = await submitMatchDeckAction({
				data: { type: "dismiss-card", itemId },
			});

			if (!isDeckActionSuccess("dismiss-card", result.actionStatus)) {
				// not_found / already_resolved / no_captured_pairs: do NOT advance the
				// card. Releasing the lock lets the user retry rather than silently
				// swallowing the error.
				onReleaseNavigation();
				return;
			}

			onSessionStats((prev) => ({
				...prev,
				dismissedCount: prev.dismissedCount + 1,
			}));
			onAddedTo([]);
			// Advance to the deck's promoted next card; the resolved card leaves
			// navigation because the server dropped it from itemIds.
			applyResolvedView(result.view);
		} catch {
			onReleaseNavigation();
		}
	};

	const handleNext = async () => {
		if (!currentReviewItem || !onLockNavigation()) return;
		try {
			await waitForPendingDismisses();
			recordCurrentItem();
			const result = await submitMatchDeckAction({
				data: { type: "finish-card", itemId },
			});

			if (!isDeckActionSuccess("finish-card", result.actionStatus)) {
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
			// Advance to the deck's promoted next card; the resolved card leaves
			// navigation because the server dropped it from itemIds.
			applyResolvedView(result.view);
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
			suggestionTotal={suggestionTotal}
			hasMoreSuggestions={hasMoreSuggestions}
			isLoadingMoreSuggestions={isLoadingMoreSuggestions}
			loadMoreSuggestions={loadMoreSuggestions}
			loadMoreError={loadMoreError}
			retryLoadMore={retryLoadMore}
			onAdd={handleAdd}
			onDismissSuggestion={handleDismissSuggestion}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onPrevious={currentIndex > 0 ? handlePrevious : undefined}
			onExit={onExit}
		/>
	);
}
