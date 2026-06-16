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
} from "@/features/matching/queries";
import {
	countAppendedFromTotal,
	nextItemIdAfterResolved,
	resolveCurrentItemId,
} from "@/features/matching/queue-helpers";
import type {
	CompletionStats,
	Playlist,
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
		// must run before getMatchReview to ensure a session row exists.
		const startResult = await startOrResumeMatchReview();

		// Prefetch the first unresolved item so the first card renders without a
		// loading spinner. Resolved items are skipped since they don't need card data.
		if (!startResult.caughtUp && startResult.itemIds.length > 0) {
			const firstId = startResult.itemIds[0];
			if (firstId) {
				await queryClient.prefetchQuery(matchReviewItemQueryOptions(firstId));
			}
		}

		// Prime the queue summary so the page's useSuspenseQuery resolves from cache.
		await queryClient.prefetchQuery(matchReviewQueryOptions(session.accountId));
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
		matchReviewQueryOptions(session.accountId),
	);

	// Ordered unresolved item ids derived from queue state — never from null song.
	// Resolved items (completed/skipped/unavailable) are excluded so the list
	// contains only cards that still need a decision.
	const unresolvedIds = useMemo(() => {
		if (!queue) return [];
		return queue.items
			.filter((item) => item.state === "pending" || item.state === "presented")
			.sort((a, b) => a.position - b.position)
			.map((item) => item.id);
	}, [queue]);

	// total reflects ALL queue items (append-only from the server).
	const total = queue?.total ?? 0;
	// caughtUp is authoritative from the server — derived from item states.
	const caughtUp = queue?.caughtUp ?? true;
	const hasQueue = !!queue?.sessionId;

	const handleExit = useCallback(() => navigate({ to: "/" }), [navigate]);

	// No queue at all means no snapshot context yet.
	if (!hasQueue) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason="no-context" />
			</div>
		);
	}

	// Queue exists but every item is resolved.
	if (caughtUp || unresolvedIds.length === 0) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason="caught-up" />
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

	const [pastItems, setPastItems] = useState<
		Array<{ id: string; albumArtUrl?: string | null; name: string }>
	>([]);

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
			queryKey: matchReviewSummaryKeys.summary(accountId),
		});
		queryClient.invalidateQueries({
			queryKey: matchReviewKeys.review(accountId),
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

	return (
		<QueueCardContent
			key={resolvedCurrentId}
			itemId={resolvedCurrentId}
			currentIndex={currentIndex}
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
	unresolvedIds: string[];
	addedTo: string[];
	navigationStatus: "idle" | "pending";
	pastItems: Array<{ id: string; albumArtUrl?: string | null; name: string }>;
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
	onPastItems: React.Dispatch<
		React.SetStateAction<
			Array<{ id: string; albumArtUrl?: string | null; name: string }>
		>
	>;
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
	const { data: itemData } = useSuspenseQuery(
		matchReviewItemQueryOptions(itemId),
	);

	// Durable presented tracking: fire once per item when it becomes current and
	// the data is ready. Newness is cleared durably and immediately, not at unload.
	// A ref-set ensures we fire at most once per item even under StrictMode.
	const presentedIdsRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (itemData.status !== "ready") return;
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

	// QueueCardContent is keyed by item id in the parent, so each new card is a
	// fresh mount. The previous card's successful action left navigation locked
	// (status "pending"); releasing on mount is what clears it for the new card.
	// The earlier per-instance "item changed" ref never fired — the remount
	// re-initialized it to the new id, so it never observed a change, leaving every
	// card after the first stuck in the locked state. onReleaseNavigation is stable
	// (useCallback), so this runs once per mount, not on every parent render.
	useEffect(() => {
		onReleaseNavigation();
	}, [onReleaseNavigation]);

	// Map server shape → component shape.
	const currentSong: SongForMatching | null =
		itemData.status === "ready"
			? {
					id: itemData.song.id,
					spotifyId: itemData.song.spotifyId,
					name: itemData.song.name,
					artist: itemData.song.artist,
					album: itemData.song.album ?? null,
					albumArtUrl: itemData.song.albumArtUrl,
					genres: itemData.song.genres,
					audioFeatures: itemData.song.audioFeatures ?? null,
					analysis: itemData.song.analysis ?? null,
				}
			: null;

	const currentMatches: Playlist[] = useMemo(
		() =>
			itemData.status === "ready"
				? itemData.matches.map((m) => ({
						id: m.playlist.id,
						spotifyId: m.playlist.spotifyId,
						name: m.playlist.name,
						reason: m.playlist.description ?? "",
						matchScore: m.score,
					}))
				: [],
		[itemData],
	);

	const { reconnectNeeded, setReconnectNeeded } = useSpotifyReconnectState(
		currentSong?.id ?? "",
	);

	// Unavailable/error card: non-scary inline state. Primary action is Next Song
	// which calls finishMatchReviewItem (marks the item skipped). No new server
	// functions needed — skipping an unavailable item is semantically correct.
	if (itemData.status === "unavailable" || itemData.status === "error") {
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
						<span>{currentIndex + 1}</span>
						<span className="theme-text-muted opacity-60">
							{" "}
							/ {unresolvedIds.length}
						</span>
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
						Next Song →
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

	// X-of-Y: both numerator and denominator are in the unresolved domain so the
	// display is consistent. The denominator updates softly as items append — that's
	// acceptable and less confusing than mixing resolved/unresolved counts.
	return (
		<Matching
			currentSong={currentSong}
			currentMatches={currentMatches}
			totalSongs={unresolvedIds.length}
			offset={currentIndex}
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
