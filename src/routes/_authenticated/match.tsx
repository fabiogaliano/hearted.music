import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { dashboardKeys } from "@/features/dashboard/queries";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { Matching } from "@/features/matching/Matching";
import {
	matchReviewItemQueryOptions,
	matchReviewKeys,
	matchReviewQueryOptions,
	matchReviewSummaryKeys,
	presentMatchReviewItemQueryOptions,
} from "@/features/matching/queries";
import {
	countAppendedFromTotal,
	deriveCaughtUp,
	deriveProgressIndex,
	deriveUnresolvedIds,
	nextItemIdAfterResolved,
	resolveCurrentItemId,
} from "@/features/matching/queue-helpers";
import type {
	CompletionStats,
	Playlist,
	ReviewedSong,
	SongForMatching,
} from "@/features/matching/types";
import { WalkthroughMatchContent } from "@/features/matching/WalkthroughMatchContent";
import { sessionMode } from "@/lib/domains/library/accounts/onboarding-session";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import {
	addSongToPlaylistFromQueueItem,
	dismissMatchReviewItem,
	finishMatchReviewItem,
	markMatchReviewItemPresented,
	startOrResumeMatchReview,
} from "@/lib/server/match-review-queue.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/match")({
	// /_authenticated already resolved the session via resolveSession.
	// Walkthrough modes skip queue bootstrap — the DU guarantees song presence.
	loader: async ({ context }) => {
		if (sessionMode(context.onboardingSession) === "walkthrough") return;
		const { session, queryClient } = context;

		// Bootstrap the queue (idempotent — resumes if one already exists). This
		// must run before the prefetches to ensure a session row exists.
		// Song orientation is the only active pass until MSR-21 wires the
		// route mode toggle to the orientation parameter.
		const startResult = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		// The queue summary and the first card are independent reads (one keys off
		// the account, the other off the item id), so fire them together — sequencing
		// them adds a needless round-trip to the route's critical path. The summary
		// primes the page's useSuspenseQuery; the first-item prefetch lets the first
		// card render without a spinner (resolved items are skipped — no card data).
		const firstId = startResult.caughtUp ? undefined : startResult.itemIds[0];
		const prefetches = [
			queryClient.prefetchQuery(
				matchReviewQueryOptions(session.accountId, "song"),
			),
		];
		if (firstId) {
			// Non-authoritative warming — fetches without capture side effects.
			prefetches.push(
				queryClient.prefetchQuery(matchReviewItemQueryOptions(firstId)),
			);
			// Authoritative first-card presentation: captures pairs and clears newness
			// so QueueCardContent renders instantly from cache without a spinner.
			prefetches.push(
				queryClient.prefetchQuery(presentMatchReviewItemQueryOptions(firstId)),
			);
		}
		await Promise.all(prefetches);
	},
	pendingComponent: MatchPending,
	component: MatchPage,
});

function MatchPending() {
	return <div className="mx-auto w-full max-w-[min(1600px,100%)]" />;
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

	return <QueueMatchPage />;
}

function QueueMatchPage() {
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: queue } = useSuspenseQuery(
		matchReviewQueryOptions(session.accountId, "song"),
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
	// Songs whose only matches sit below the strictness bar — drives the
	// "loosen strictness" empty state over the "nothing surfaced" one.
	const hiddenSongCount = queue?.hiddenSongCount ?? 0;

	// Latch: once this visit has had unresolved items to work, keep rendering the
	// session UI for the rest of the visit. Completing the last card invalidates the
	// queue query, and its refetch reports caughtUp — without this latch the parent
	// would tear the just-rendered CompletionScreen back down to an empty state
	// (the "quiet in here" flash). The session's own isComplete logic owns the
	// completion view; the empty state is only for arriving already caught up.
	const sessionStartedRef = useRef(false);
	if (!caughtUp) sessionStartedRef.current = true;

	const handleExit = useCallback(() => navigate({ to: "/" }), [navigate]);

	// No queue at all means no snapshot context yet.
	if (!hasQueue) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason="no-context" />
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
		const reason =
			hiddenSongCount > 0 ? "filtered" : total === 0 ? "none-yet" : "caught-up";
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason={reason} hiddenCount={hiddenSongCount} />
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<QueueMatchContent
				accountId={session.accountId}
				itemIds={unresolvedIds}
				total={total}
				onExit={handleExit}
				queryClient={queryClient}
			/>
		</div>
	);
}

interface QueueMatchContentProps {
	accountId: string;
	itemIds: string[];
	total: number;
	onExit: () => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueMatchContent({
	accountId,
	itemIds,
	total,
	onExit,
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

	const [pastItems, setPastItems] = useState<ReviewedSong[]>([]);

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
	// completes all cards or navigates away mid-session.
	const invalidateSessionBoundary = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: matchReviewSummaryKeys.summary(accountId, "song"),
		});
		queryClient.invalidateQueries({
			queryKey: matchReviewKeys.review(accountId, "song"),
		});
		queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
	}, [queryClient, accountId]);

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
			totalSongs: total,
			songsMatched: sessionStats.songsWithAdditions.size,
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
				currentSong={null}
				currentMatches={[]}
				totalSongs={total}
				offset={effectiveItemIds.length}
				addedTo={[]}
				isComplete={true}
				completionStats={completionStats}
				recentSongs={pastItems}
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
			onExit={onExit}
			analytics={analytics}
			queryClient={queryClient}
		/>
	);
}

interface QueueCardContentProps {
	itemId: string;
	currentIndex: number;
	// Full session size (queue.total, append-only). The progress header's
	// denominator, distinct from currentIndex/unresolvedIds which live in the
	// shrinking navigable domain.
	total: number;
	unresolvedIds: string[];
	addedTo: string[];
	navigationStatus: "idle" | "pending";
	pastItems: ReviewedSong[];
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
	onPastItems: React.Dispatch<React.SetStateAction<ReviewedSong[]>>;
	onCurrentItemId: React.Dispatch<React.SetStateAction<string | null>>;
	// Marks the current card resolved locally and advances to the next unresolved
	// card. Use after a successful finish/dismiss/skip so a resolved card cannot be
	// revisited via Previous before the server snapshot catches up.
	onResolveCurrentItem: (resolvedId: string) => void;
	onLockNavigation: () => boolean;
	onReleaseNavigation: () => void;
	onExit: () => void;
	analytics: ReturnType<typeof useAnalytics>;
	queryClient: ReturnType<typeof useQueryClient>;
}

function QueueCardContent({
	itemId,
	currentIndex,
	total,
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
	onExit,
	analytics,
	queryClient,
}: QueueCardContentProps) {
	// Authoritative card render: reads from captured pair rows (MSR-25).
	// matchReviewItemQueryOptions is kept for next-card warming only (D9, D10).
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

	// Prefetch the next two items by id so they're in cache before navigation.
	useEffect(() => {
		const next1 = unresolvedIds[currentIndex + 1];
		const next2 = unresolvedIds[currentIndex + 2];
		if (next1) queryClient.prefetchQuery(matchReviewItemQueryOptions(next1));
		if (next2) queryClient.prefetchQuery(matchReviewItemQueryOptions(next2));
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

	// Map server shape → component shape.
	const currentSong: SongForMatching | null =
		itemData.status === "ready"
			? {
					id: itemData.reviewItem.id,
					spotifyId: itemData.reviewItem.spotifyId,
					name: itemData.reviewItem.name,
					artist: itemData.reviewItem.artist,
					album: itemData.reviewItem.album ?? null,
					albumArtUrl: itemData.reviewItem.albumArtUrl,
					genres: itemData.reviewItem.genres,
					audioFeatures: itemData.reviewItem.audioFeatures ?? null,
					analysis: itemData.reviewItem.analysis ?? null,
				}
			: null;

	const currentMatches: Playlist[] = useMemo(
		() =>
			itemData.status === "ready"
				? itemData.suggestions.map((m) => ({
						id: m.playlist.id,
						spotifyId: m.playlist.spotifyId,
						name: m.playlist.name,
						reason: m.playlist.description ?? "",
						matchScore: m.score,
						imageUrl: m.playlist.imageUrl,
						songCount: m.playlist.trackCount,
					}))
				: [],
		[itemData],
	);

	const { reconnectNeeded, setReconnectNeeded } = useSpotifyReconnectState(
		currentSong?.id ?? "",
	);

	// Header progress: position within the whole session, NOT within the shrinking
	// navigable list. Resolved cards drop out of unresolvedIds, so currentIndex is
	// always ~0 (the current card is the head of what's left); using it as the
	// numerator pinned the display at 1/N and made N count down as cards resolved.
	// total − remaining advances the numerator instead.
	const progressIndex = deriveProgressIndex(total, unresolvedIds.length);

	// Unavailable/error card: non-scary inline state. Primary action is Next Song
	// which calls finishMatchReviewItem (marks the item skipped). No new server
	// functions needed — skipping an unavailable item is semantically correct.
	if (
		itemData.status === "unavailable" ||
		itemData.status === "retryable-error"
	) {
		const message =
			itemData.status === "unavailable"
				? itemData.message
				: "Something went wrong loading this song.";

		const handleSkipUnavailable = async () => {
			if (!onLockNavigation()) return;
			try {
				const result = await finishMatchReviewItem({ data: { itemId } });

				if (!result.success) {
					// Server rejected the finish (e.g. decision-count-failed) — do NOT
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
				<div className="mb-12">
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
				<div
					className="theme-surface-bg theme-border-color flex flex-col items-start gap-4 border p-6"
					role="status"
					aria-label="Song unavailable"
				>
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						{message}
					</p>
					<button
						type="button"
						onClick={handleSkipUnavailable}
						className="theme-primary text-sm font-medium tracking-wide"
						style={{ fontFamily: fonts.body }}
						disabled={navigationStatus === "pending"}
					>
						Skip Song →
					</button>
				</div>
			</div>
		);
	}

	const recordCurrentItem = () => {
		if (!currentSong) return;
		onPastItems((prev) => {
			if (prev.some((s) => s.id === currentSong.id)) return prev;
			return [
				...prev,
				{
					id: currentSong.id,
					albumArtUrl: currentSong.albumArtUrl,
					name: currentSong.name,
					artist: currentSong.artist,
				},
			];
		});
	};

	const handleAdd = async (playlistId: string) => {
		// Add does NOT advance the card — user may add to multiple playlists.
		// It still locks navigation while the add decision is in flight so Finish or
		// Dismiss cannot resolve the item before the add row exists.
		if (!currentSong || !onLockNavigation()) return;
		try {
			setReconnectNeeded(false);

			const playlist = currentMatches.find((p) => p.id === playlistId);

			// Optimistic Spotify extension call — mirrors the old addSongToPlaylist path.
			// The queue item id carries the server-side context so snapshotId is never
			// supplied by the client.
			if (playlist?.spotifyId && currentSong.spotifyId) {
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
				data: { itemId, playlistId },
			});

			if (!addResult.success) return;

			analytics.capture("song_added_to_playlist", {
				song_id: currentSong.id,
				playlist_id: playlistId,
				playlist_name: playlist?.name,
			});

			onAddedTo((prev) => [...prev, playlistId]);
			onSessionStats((prev) => {
				const next = new Set(prev.songsWithAdditions);
				next.add(currentSong.id);
				return {
					...prev,
					addedCount: prev.addedCount + 1,
					songsWithAdditions: next,
				};
			});
		} finally {
			onReleaseNavigation();
		}
	};

	const handleDismiss = async () => {
		if (!currentSong || !onLockNavigation()) return;
		try {
			recordCurrentItem();
			analytics.capture("song_dismissed", { song_id: currentSong.id });

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
		if (!currentSong || !onLockNavigation()) return;
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
			currentSong={currentSong}
			currentMatches={currentMatches}
			totalSongs={total}
			offset={progressIndex}
			addedTo={addedTo}
			isComplete={false}
			completionStats={completionStats}
			recentSongs={pastItems}
			reconnectNeeded={reconnectNeeded}
			navigationDisabled={navigationStatus === "pending"}
			onAdd={handleAdd}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onPrevious={currentIndex > 0 ? handlePrevious : undefined}
			onExit={onExit}
		/>
	);
}
