import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { useMatchingSession } from "@/features/matching/hooks/useMatchingSession";
import { Matching } from "@/features/matching/Matching";
import {
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
		if (matchingSession && matchingSession.totalSongs > 0) {
			await queryClient.ensureQueryData(
				songMatchesQueryOptions(matchingSession.snapshotId, 0),
			);
		}
	},
	pendingComponent: MatchPending,
	component: MatchPage,
});

interface DisplayedSession {
	snapshotId: string;
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
						totalSongs: latestSession.totalSongs,
					}
				: null,
		);

	const latestSnapshotId = latestSession?.snapshotId ?? null;
	const latestTotalSongs = latestSession?.totalSongs ?? 0;

	const hasNewSnapshot =
		displayedSession != null &&
		latestSnapshotId != null &&
		latestSnapshotId !== displayedSession.snapshotId &&
		latestTotalSongs > 0;

	const handleExit = useCallback(() => navigate({ to: "/" }), [navigate]);

	const handleRefresh = useCallback(() => {
		if (!latestSnapshotId || latestTotalSongs === 0) return;
		setDisplayedSession({
			snapshotId: latestSnapshotId,
			totalSongs: latestTotalSongs,
		});
	}, [latestSnapshotId, latestTotalSongs]);

	// No session at all and never had one
	if (!displayedSession && (!latestSnapshotId || latestTotalSongs === 0)) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={!latestSnapshotId ? "no-context" : "all-decided"}
				/>
			</div>
		);
	}

	// Had a session but it's now empty (all decided) and no new one
	if (!displayedSession) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState reason="all-decided" />
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
	totalSongs: number;
	accountId: string;
	onExit: () => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function MatchingPageContent({
	snapshotId,
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

	const isComplete = offset >= totalSongs;

	const completionCapturedRef = useRef(false);
	useEffect(() => {
		if (!isComplete || completionCapturedRef.current) return;
		completionCapturedRef.current = true;
		analytics.capture("matching_session_completed", {
			total_songs: totalSongs,
		});
	}, [isComplete, totalSongs, analytics]);

	const { data: songData } = useSuspenseQuery(
		songMatchesQueryOptions(snapshotId, offset),
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
		queryClient.prefetchQuery(songMatchesQueryOptions(snapshotId, offset + 1));
		queryClient.prefetchQuery(songMatchesQueryOptions(snapshotId, offset + 2));
	}, [queryClient, snapshotId, offset, songData]);

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
		[currentSong, currentMatches, addPresented, setReconnectNeeded, analytics],
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
				await dismissSong({ data: { songId: currentSong.id, playlistIds } });
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
