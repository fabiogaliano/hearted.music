import {
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { Suspense, useCallback, useEffect, useRef } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import {
	matchDeckKeys,
	matchDeckQueryOptions,
} from "@/features/matching/deck-queries";
import {
	hasNonCanonicalMatchMode,
	modeFromSearch,
	validateMatchSearch,
} from "@/features/matching/match-search";
import { QueueMatchContent } from "@/features/matching/QueueMatchSession";
import { matchReviewSummaryKeys } from "@/features/matching/queries";
import { deriveEmptyStateReason } from "@/features/matching/queue-helpers";
import { seedBakedDeckCardReads } from "@/features/matching/seed-deck-cards";
import type { MatchViewMode } from "@/features/matching/types";
import { WalkthroughMatchContent } from "@/features/matching/WalkthroughMatchContent";
import { sessionMode } from "@/lib/domains/library/accounts/onboarding-session";
import {
	accountEventsConnectionKey,
	type ConnectionState,
} from "@/lib/hooks/useAccountEvents";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { captureRouteError } from "@/lib/observability/sentry";
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
		// advance) resolve from cache instead of re-fetching. If a baked card is a
		// transient retryable error, re-read it once here instead of pinning that
		// error into the long-lived card cache. The building state
		// (`{status:"building"}`) has no `itemIds`/cards to seed.
		if ("itemIds" in view) {
			await seedBakedDeckCardReads(queryClient, [
				view.cards.current,
				view.cards.next,
			]);
		}
	},
	errorComponent: MatchErrorComponent,
	pendingComponent: MatchLoading,
	component: MatchPage,
});

// Building-recovery poll tuning (M8): fixed interval rather than exponential
// backoff — the miss-path promotion either lands within a couple of attempts
// or the build genuinely needs longer, in which case stopping and falling
// back to refocus/manual retry is preferable to polling indefinitely.
const BUILDING_POLL_INTERVAL_MS = 3_000;
const MAX_BUILDING_POLLS = 5;

// Post-refresh append poll tuning (M13): same fixed-interval, bounded-count
// shape as the building poll. A completed matchSnapshotRefresh invalidates the
// deck once (useActiveJobCompletionEffects), but the append itself is a
// separate append_sessions worker write that can land AFTER that invalidation,
// so a single refetch can miss it. On the refresh running->idle falling edge we
// re-poll the deck a bounded number of times to surface the lagging append; if
// it never arrives within the window we stop rather than poll indefinitely.
const APPEND_POLL_INTERVAL_MS = 3_000;
const MAX_APPEND_POLLS = 5;

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

	// Poll active jobs so the empty/building states can distinguish "still
	// building" from "truly empty", and so the deck query below knows whether a
	// building-recovery poll is worth attempting. Shares the cache entry with
	// the layout's completion-effects hook — no extra fetches.
	const {
		isEnrichmentRunning,
		isMatchSnapshotRefreshRunning,
		firstVisibleMatchReady,
	} = useActiveJobs(session.accountId);
	const { data: accountEventsConnectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(session.accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});
	const isJobsActive = isEnrichmentRunning || isMatchSnapshotRefreshRunning;
	const isStreamConnected = accountEventsConnectionState === "connected";

	// Building-recovery poll baseline (M8): the refetchInterval below counts
	// polls via the query's dataUpdateCount relative to this baseline, captured
	// the moment the gating condition (still building AND a first visible match
	// ready) turns true, and cleared the moment it turns false — so a later
	// building spell gets its own fresh bounded window.
	const buildingPollBaselineRef = useRef<number | null>(null);

	// Post-refresh append poll (M13): armed on the isMatchSnapshotRefreshRunning
	// running->idle falling edge and cleared once the bounded window elapses.
	// baseline captures dataUpdateCount at the first armed poll so polls are
	// counted the same way the building poll counts them.
	const appendPollActiveRef = useRef(false);
	const appendPollBaselineRef = useRef<number | null>(null);
	const prevSnapshotRefreshRunningRef = useRef(false);

	// Render-phase falling-edge detection (store-previous-value pattern): arming
	// the ref here — before useSuspenseQuery reads refetchInterval below — starts
	// the poll on the same render the refresh finishes, with no throwaway state
	// bump. Idempotent, so Strict Mode's double render can't double-arm.
	if (
		prevSnapshotRefreshRunningRef.current &&
		!isMatchSnapshotRefreshRunning &&
		!isStreamConnected
	) {
		appendPollActiveRef.current = true;
		appendPollBaselineRef.current = null;
	}
	prevSnapshotRefreshRunningRef.current = isMatchSnapshotRefreshRunning;

	// ONE read: the whole page renders from the deck view (or the building state).
	//
	// Building-state recovery (RC): a first-run user who opened /match before any
	// proposal existed gets `{status:"building"}` and no session. Once a first
	// visible match becomes ready, `refetchInterval` re-runs the bounded deck
	// read every few seconds — its miss path promotes the first window and
	// returns an active view. A single retry is not enough: the miss-path
	// promotion can itself report `{status:"building"}` again
	// (`promotion_incomplete`), so this polls a bounded number of times instead
	// of firing once (the old one-shot effect could strand the user on
	// "building" until an incidental refocus refetch), and stops as soon as the
	// view is no longer building or firstVisibleMatchReady goes false. Replaces
	// bootstrapReadyMatchQueue.
	const { data: view } = useSuspenseQuery({
		...matchDeckQueryOptions(session.accountId, mode),
		refetchInterval: (query) => {
			const data = query.state.data;
			const stillBuilding = data !== undefined && !("itemIds" in data);

			if (isStreamConnected) {
				buildingPollBaselineRef.current = null;
				appendPollActiveRef.current = false;
				appendPollBaselineRef.current = null;
				return false;
			}

			if (stillBuilding && firstVisibleMatchReady) {
				if (buildingPollBaselineRef.current === null) {
					buildingPollBaselineRef.current = query.state.dataUpdateCount;
				}
				const pollsSoFar =
					query.state.dataUpdateCount - buildingPollBaselineRef.current;
				return pollsSoFar >= MAX_BUILDING_POLLS
					? false
					: BUILDING_POLL_INTERVAL_MS;
			}
			buildingPollBaselineRef.current = null;

			// Post-refresh append poll (M13): when the stream is unavailable, keep a
			// bounded self-heal for a lagging append_sessions write after the refresh
			// completes. With a live stream, match_deck_appended invalidates the deck
			// directly so this fallback must stay quiet.
			if (appendPollActiveRef.current && !stillBuilding) {
				if (appendPollBaselineRef.current === null) {
					appendPollBaselineRef.current = query.state.dataUpdateCount;
				}
				const pollsSoFar =
					query.state.dataUpdateCount - appendPollBaselineRef.current;
				if (pollsSoFar >= MAX_APPEND_POLLS) {
					appendPollActiveRef.current = false;
					appendPollBaselineRef.current = null;
					return false;
				}
				return APPEND_POLL_INTERVAL_MS;
			}

			return false;
		},
	});

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
