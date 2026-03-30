import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Matching } from "@/features/matching/Matching";
import { MatchingEmptyState } from "@/features/matching/components/MatchingEmptyState";
import { useMatchingSession } from "@/features/matching/hooks/useMatchingSession";
import {
	matchingSessionQueryOptions,
	songMatchesQueryOptions,
} from "@/features/matching/queries";
import type {
	CompletionStats,
	Playlist,
	SongForMatching,
} from "@/features/matching/types";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import {
	addSongToPlaylist,
	dismissSong,
} from "@/lib/server/matching.functions";

export const Route = createFileRoute("/_authenticated/match")({
	loader: async ({ context }) => {
		const { session, queryClient } = context;
		await queryClient.ensureQueryData(
			matchingSessionQueryOptions(session.accountId),
		);
	},
	component: MatchPage,
});

interface DisplayedSession {
	contextId: string;
	totalSongs: number;
}

function MatchPage() {
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const theme = useTheme();

	const { data: latestSession } = useSuspenseQuery(
		matchingSessionQueryOptions(session.accountId),
	);

	const [displayedSession, setDisplayedSession] =
		useState<DisplayedSession | null>(() =>
			latestSession && latestSession.totalSongs > 0
				? {
						contextId: latestSession.contextId,
						totalSongs: latestSession.totalSongs,
					}
				: null,
		);

	const latestContextId = latestSession?.contextId ?? null;
	const latestTotalSongs = latestSession?.totalSongs ?? 0;

	const hasNewContext =
		displayedSession != null &&
		latestContextId != null &&
		latestContextId !== displayedSession.contextId &&
		latestTotalSongs > 0;

	const handleRefresh = useCallback(() => {
		if (!latestContextId || latestTotalSongs === 0) return;
		setDisplayedSession({
			contextId: latestContextId,
			totalSongs: latestTotalSongs,
		});
	}, [latestContextId, latestTotalSongs]);

	// No session at all and never had one
	if (!displayedSession && (!latestContextId || latestTotalSongs === 0)) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingEmptyState
					reason={!latestContextId ? "no-context" : "all-decided"}
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
			{hasNewContext && (
				<div
					className="mb-4 flex items-center justify-between rounded-lg px-5 py-3"
					style={{
						background: theme.surface,
						border: `1px solid ${theme.border}`,
					}}
				>
					<p
						className="text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						New match suggestions are available.
					</p>
					<button
						onClick={handleRefresh}
						className="cursor-pointer text-xs font-medium uppercase tracking-widest transition-opacity hover:opacity-70"
						style={{ fontFamily: fonts.body, color: theme.primary }}
					>
						Refresh
					</button>
				</div>
			)}
			<MatchingPageContent
				key={displayedSession.contextId}
				contextId={displayedSession.contextId}
				totalSongs={displayedSession.totalSongs}
				accountId={session.accountId}
				onExit={() => navigate({ to: "/" })}
				queryClient={queryClient}
			/>
		</div>
	);
}

interface MatchingPageContentProps {
	contextId: string;
	totalSongs: number;
	accountId: string;
	onExit: () => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

function MatchingPageContent({
	contextId,
	totalSongs,
	accountId,
	onExit,
	queryClient,
}: MatchingPageContentProps) {
	const [offset, setOffset] = useState(0);
	const [addedTo, setAddedTo] = useState<string[]>([]);

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

	const { data: songData } = useSuspenseQuery(
		songMatchesQueryOptions(contextId, offset),
	);

	useEffect(() => {
		if (!songData) return;
		queryClient.prefetchQuery(songMatchesQueryOptions(contextId, offset + 1));
		queryClient.prefetchQuery(songMatchesQueryOptions(contextId, offset + 2));
	}, [queryClient, contextId, offset, songData]);

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

	const currentSong: SongForMatching | null = songData?.song ?? null;
	const currentMatches: Playlist[] =
		songData?.matches.map((m) => ({
			id: m.playlist.id,
			name: m.playlist.name,
			reason: m.playlist.description ?? "",
			matchScore: m.score,
		})) ?? [];

	const completionStats: CompletionStats = {
		totalSongs,
		songsMatched: sessionStats.songsWithAdditions.size,
		totalAdditions: sessionStats.addedCount,
		skippedCount:
			offset -
			sessionStats.songsWithAdditions.size -
			sessionStats.dismissedCount,
	};

	const handleAdd = async (playlistId: string) => {
		if (!currentSong) return;
		addPresented(currentSong.id);
		await addSongToPlaylist({
			data: {
				songId: currentSong.id,
				playlistId,
			},
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
	};

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

	const handleDismiss = async () => {
		if (!currentSong) return;
		addPresented(currentSong.id);
		recordCurrentSong();
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
	};

	const handleNext = () => {
		if (currentSong) addPresented(currentSong.id);
		recordCurrentSong();
		setAddedTo([]);
		setOffset((prev) => prev + 1);
	};

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
			onAdd={handleAdd}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onExit={onExit}
		/>
	);
}
