import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { dashboardKeys } from "@/features/dashboard/queries";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { useMatchingSession } from "@/features/matching/hooks/useMatchingSession";
import { Matching } from "@/features/matching/Matching";
import {
	matchingKeys,
	matchingSessionQueryOptions,
	songMatchesQueryOptions,
} from "@/features/matching/queries";
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
	addSongToPlaylist,
	dismissSong,
} from "@/lib/server/matching.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/match")({
	// No precondition guard needed. `/_authenticated` already resolved the
	// session via `resolveSession`; if the user is here and the session is
	// in `match-walkthrough`, the DU guarantees `session.song` is populated.
	loader: async ({ context }) => {
		if (sessionMode(context.onboardingSession) === "walkthrough") return;
		const { session, queryClient } = context;
		const matchingSession = await queryClient.ensureQueryData(
			matchingSessionQueryOptions(session.accountId),
		);
		if (matchingSession && matchingSession.songIds.length > 0) {
			await queryClient.ensureQueryData(
				songMatchesQueryOptions(
					matchingSession.snapshotId,
					matchingSession.songIds[0],
				),
			);
		}
	},
	pendingComponent: MatchPending,
	component: MatchPage,
});

interface DisplayedSession {
	snapshotId: string;
	songIds: string[];
	totalSongs: number;
}

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

	return <NormalMatchPage />;
}

function NormalMatchPage() {
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: latestSession } = useSuspenseQuery(
		matchingSessionQueryOptions(session.accountId),
	);

	const [displayedSession, setDisplayedSession] =
		useState<DisplayedSession | null>(() =>
			latestSession && latestSession.totalSongs > 0
				? {
						snapshotId: latestSession.snapshotId,
						songIds: latestSession.songIds,
						totalSongs: latestSession.totalSongs,
					}
				: null,
		);

	const latestSnapshotId = latestSession?.snapshotId ?? null;
	const latestTotalSongs = latestSession?.totalSongs ?? 0;
	const hiddenSongCount = latestSession?.hiddenSongCount ?? 0;

	const hasNewSnapshot =
		displayedSession != null &&
		latestSnapshotId != null &&
		latestSnapshotId !== displayedSession.snapshotId &&
		latestTotalSongs > 0;

	const handleExit = useCallback(() => navigate({ to: "/" }), [navigate]);

	// Swap in the new frozen list only on explicit Refresh — mid-session new
	// snapshots never silently reorder the active walk.
	const handleRefresh = useCallback(() => {
		if (!latestSession || latestSession.totalSongs === 0) return;
		setDisplayedSession({
			snapshotId: latestSession.snapshotId,
			songIds: latestSession.songIds,
			totalSongs: latestSession.totalSongs,
		});
	}, [latestSession]);

	// No session at all and never had one. When a snapshot exists but the queue
	// is empty purely because the strictness bar hid every match, steer to the
	// "filtered" state (links back to settings) instead of "all-decided".
	if (!displayedSession && (!latestSnapshotId || latestTotalSongs === 0)) {
		const reason = !latestSnapshotId
			? "no-context"
			: hiddenSongCount > 0
				? "filtered"
				: "all-decided";
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason={reason} hiddenCount={hiddenSongCount} />
			</div>
		);
	}

	// Had a session but it's now empty (all decided) and no new one
	if (!displayedSession) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={hiddenSongCount > 0 ? "filtered" : "all-decided"}
					hiddenCount={hiddenSongCount}
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			{hasNewSnapshot && (
				<div className="theme-surface-bg theme-border-color mb-4 flex items-center justify-between border px-5 py-3">
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						New match suggestions are available.
					</p>
					<Button
						variant="link"
						size="sm"
						onClick={handleRefresh}
						className="theme-primary"
						style={{ fontFamily: fonts.body }}
					>
						Refresh
					</Button>
				</div>
			)}
			<MatchingPageContent
				key={displayedSession.snapshotId}
				snapshotId={displayedSession.snapshotId}
				songIds={displayedSession.songIds}
				totalSongs={displayedSession.totalSongs}
				accountId={session.accountId}
				onExit={handleExit}
				queryClient={queryClient}
			/>
		</div>
	);
}

interface MatchingPageContentProps {
	snapshotId: string;
	songIds: string[];
	totalSongs: number;
	accountId: string;
	onExit: () => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function MatchingPageContent({
	snapshotId,
	songIds,
	totalSongs,
	accountId,
	onExit,
	queryClient,
}: MatchingPageContentProps) {
	const analytics = useAnalytics();
	const [offset, setOffset] = useState(0);
	const [addedTo, setAddedTo] = useState<string[]>([]);
	const [navigationStatus, setNavigationStatus] = useState<"idle" | "pending">(
		"idle",
	);
	const navigationLockedRef = useRef(false);

	const [sessionStats, setSessionStats] = useState(() => ({
		addedCount: 0,
		dismissedCount: 0,
		songsWithAdditions: new Set<string>(),
	}));

	const [pastSongs, setPastSongs] = useState<
		Array<{ id: string; albumArtUrl?: string | null; name: string }>
	>([]);

	const { addPresented } = useMatchingSession(accountId);

	// Numerically identical to the old `offset >= totalSongs` (totalSongs ===
	// songIds.length), but indexing against the frozen list is the whole point:
	// a recorded decision can no longer shift which song slot N points to.
	const isComplete = offset >= songIds.length;

	// Refreshing both query families at the session boundary fixes the stale
	// sidebar badge and dashboard fan-spread. Safe mid-walk: the active session
	// reads the frozen `songIds`, not the live query, so a refetch never disturbs
	// the in-progress walk.
	const invalidateSessionBoundary = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: matchingKeys.all });
		queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
	}, [queryClient]);

	const completionCapturedRef = useRef(false);
	useEffect(() => {
		if (!isComplete || completionCapturedRef.current) return;
		completionCapturedRef.current = true;
		analytics.capture("matching_session_completed", {
			total_songs: totalSongs,
		});
		// Refresh the badge while the user is still on the CompletionScreen.
		invalidateSessionBoundary();
	}, [isComplete, totalSongs, analytics, invalidateSessionBoundary]);

	// Covers every departure path: CompletionScreen "Back to Home", mid-session
	// sidebar navigation (which onExit never sees), and the Refresh remount.
	useEffect(
		() => () => {
			invalidateSessionBoundary();
		},
		[invalidateSessionBoundary],
	);

	// Clamp is mandatory, not stylistic: useSuspenseQuery has no `enabled` and
	// hooks can't be conditional. When offset === songIds.length the clamped id is
	// the song the user just decided — already cached, never re-rendered because
	// `Matching` receives currentSong only while !isComplete. songIds.length >= 1
	// is guaranteed (displayedSession is set only when totalSongs > 0).
	const currentSongId = songIds[Math.min(offset, songIds.length - 1)];
	const { data: songData } = useSuspenseQuery(
		songMatchesQueryOptions(snapshotId, currentSongId),
	);
	const currentSong: SongForMatching | null = songData?.song ?? null;

	const { reconnectNeeded, setReconnectNeeded } = useSpotifyReconnectState(
		currentSong?.id ?? "",
	);

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

	const navigationTargetKey = isComplete
		? "complete"
		: (currentSong?.id ?? "none");

	useEffect(() => {
		if (!navigationTargetKey) return;
		releaseNavigation();
	}, [navigationTargetKey, releaseNavigation]);

	useEffect(() => {
		if (!songData) return;
		const next1 = songIds[offset + 1];
		const next2 = songIds[offset + 2];
		if (next1) {
			queryClient.prefetchQuery(songMatchesQueryOptions(snapshotId, next1));
		}
		if (next2) {
			queryClient.prefetchQuery(songMatchesQueryOptions(snapshotId, next2));
		}
	}, [queryClient, snapshotId, offset, songData, songIds]);

	const recentSongs = useMemo(() => {
		if (!songData || pastSongs.some((s) => s.id === songData.song.id))
			return pastSongs;
		return [
			...pastSongs,
			{
				id: songData.song.id,
				albumArtUrl: songData.song.albumArtUrl,
				name: songData.song.name,
			},
		];
	}, [songData, pastSongs]);

	const currentMatches: Playlist[] = useMemo(
		() =>
			songData?.matches.map((m) => ({
				id: m.playlist.id,
				spotifyId: m.playlist.spotifyId,
				name: m.playlist.name,
				reason: m.playlist.description ?? "",
				matchScore: m.score,
			})) ?? [],
		[songData?.matches],
	);

	const completionStats: CompletionStats = useMemo(
		() => ({
			totalSongs,
			songsMatched: sessionStats.songsWithAdditions.size,
			totalAdditions: sessionStats.addedCount,
			dismissedCount: sessionStats.dismissedCount,
			skippedCount:
				offset -
				sessionStats.songsWithAdditions.size -
				sessionStats.dismissedCount,
		}),
		[totalSongs, sessionStats, offset],
	);

	const handleAdd = useCallback(
		async (playlistId: string) => {
			if (!currentSong || navigationLockedRef.current) return;
			setReconnectNeeded(false);
			addPresented(currentSong.id);
			const playlist = currentMatches.find((p) => p.id === playlistId);
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
			await addSongToPlaylist({
				data: {
					songId: currentSong.id,
					playlistId,
					snapshotId,
				},
			});
			analytics.capture("song_added_to_playlist", {
				song_id: currentSong.id,
				playlist_id: playlistId,
				playlist_name: currentMatches.find((p) => p.id === playlistId)?.name,
			});
			setAddedTo((prev) => [...prev, playlistId]);
			setSessionStats((prev) => {
				const next = new Set(prev.songsWithAdditions);
				next.add(currentSong.id);
				return {
					...prev,
					addedCount: prev.addedCount + 1,
					songsWithAdditions: next,
				};
			});
		},
		[
			currentSong,
			currentMatches,
			addPresented,
			setReconnectNeeded,
			analytics,
			snapshotId,
		],
	);

	const recordCurrentSong = useCallback(() => {
		if (!currentSong) return;
		setPastSongs((prev) => {
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
	}, [currentSong]);

	const handleDismiss = useCallback(async () => {
		if (!currentSong || !lockNavigation()) return;
		try {
			addPresented(currentSong.id);
			recordCurrentSong();
			analytics.capture("song_dismissed", { song_id: currentSong.id });
			const playlistIds = currentMatches.map((m) => m.id);
			if (playlistIds.length > 0) {
				await dismissSong({
					data: { songId: currentSong.id, playlistIds, snapshotId },
				});
			}
			setSessionStats((prev) => ({
				...prev,
				dismissedCount: prev.dismissedCount + 1,
			}));
			setAddedTo([]);
			setOffset((prev) => prev + 1);
		} catch (error) {
			releaseNavigation();
			throw error;
		}
	}, [
		currentSong,
		currentMatches,
		addPresented,
		recordCurrentSong,
		lockNavigation,
		releaseNavigation,
		analytics,
		snapshotId,
	]);

	const handleNext = useCallback(() => {
		if (!currentSong || !lockNavigation()) return;
		addPresented(currentSong.id);
		recordCurrentSong();
		setAddedTo([]);
		setOffset((prev) => prev + 1);
	}, [currentSong, addPresented, recordCurrentSong, lockNavigation]);

	const handlePrevious = useCallback(() => {
		if (offset === 0 || !lockNavigation()) return;
		setAddedTo([]);
		setOffset((prev) => Math.max(0, prev - 1));
	}, [offset, lockNavigation]);

	return (
		<Matching
			currentSong={isComplete ? null : currentSong}
			currentMatches={currentMatches}
			totalSongs={totalSongs}
			offset={offset}
			addedTo={addedTo}
			isComplete={isComplete}
			completionStats={completionStats}
			recentSongs={recentSongs}
			reconnectNeeded={reconnectNeeded}
			navigationDisabled={navigationStatus === "pending"}
			onAdd={handleAdd}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onPrevious={handlePrevious}
			onExit={onExit}
		/>
	);
}
