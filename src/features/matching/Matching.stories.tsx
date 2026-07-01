import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { playlistKeys } from "@/features/playlists/queries";
import { matchExperience, matchingSongs } from "@/stories/fixtures";
import { Matching } from "./Matching";
import type {
	CompletionStats,
	PlaylistForMatching,
	SongForMatching,
	SongSuggestionRow,
} from "./types";

export default {
	title: "Match/Page",
};

const defaultCompletionStats: CompletionStats = {
	totalItems: matchingSongs.length,
	itemsMatched: 0,
	totalAdditions: 0,
	dismissedCount: 0,
	skippedCount: 0,
};

export const FirstSong: Story = () => {
	const first = matchingSongs[0];
	if (!first) return <div>No matching data</div>;

	return (
		<Matching
			currentReviewItem={{ mode: "song" as const, song: first.song }}
			currentSuggestions={first.playlists.map((p) => ({
				mode: "song" as const,
				playlist: p,
			}))}
			totalSongs={matchingSongs.length}
			offset={0}
			addedTo={[]}
			isComplete={false}
			completionStats={defaultCompletionStats}
			recentItems={[]}
			onAdd={() => {}}
			onDismiss={() => {}}
			onNext={() => {}}
			onExit={() => {}}
		/>
	);
};

export const InteractiveSession: Story = () => {
	const [index, setIndex] = useState(0);
	const [addedTo, setAddedTo] = useState<string[]>([]);
	const [stats, setStats] = useState(defaultCompletionStats);

	const current = matchingSongs[index];
	const isComplete = index >= matchingSongs.length;

	if (isComplete || !current) {
		return (
			<Matching
				currentReviewItem={null}
				currentSuggestions={[]}
				totalSongs={matchingSongs.length}
				offset={index}
				addedTo={[]}
				isComplete={true}
				completionStats={stats}
				recentItems={matchingSongs.slice(0, index).map((m) => ({
					id: m.song.id,
					albumArtUrl: m.song.albumArtUrl,
					name: m.song.name,
					artist: m.song.artist,
				}))}
				onAdd={() => {}}
				onDismiss={() => {}}
				onNext={() => {}}
				onExit={() => {}}
			/>
		);
	}

	return (
		<Matching
			currentReviewItem={{ mode: "song" as const, song: current.song }}
			currentSuggestions={current.playlists.map((p) => ({
				mode: "song" as const,
				playlist: p,
			}))}
			totalSongs={matchingSongs.length}
			offset={index}
			addedTo={addedTo}
			isComplete={false}
			completionStats={stats}
			recentItems={matchingSongs.slice(0, index).map((m) => ({
				id: m.song.id,
				albumArtUrl: m.song.albumArtUrl,
				name: m.song.name,
				artist: m.song.artist,
			}))}
			onAdd={(playlistId) => {
				setAddedTo((prev) => [...prev, playlistId]);
				setStats((s) => ({
					...s,
					itemsMatched: s.itemsMatched + 1,
					totalAdditions: s.totalAdditions + 1,
				}));
			}}
			onDismiss={() => {
				setStats((s) => ({ ...s, skippedCount: s.skippedCount + 1 }));
				setAddedTo([]);
				setIndex((i) => i + 1);
			}}
			onNext={() => {
				setAddedTo([]);
				setIndex((i) => i + 1);
			}}
			onExit={() => {}}
		/>
	);
};
InteractiveSession.meta = {
	description:
		"Walk through matching songs — add to playlists, skip, or dismiss",
};

/**
 * The whole /match experience on real data: real songs, real playlists (covers,
 * descriptions) and real per-playlist track membership from the local DB. Hover a
 * match row to reveal the preview card — the cover, the playlist's "what it's
 * for", and its real, scrollable track list. Only the song→playlist pairings and
 * scores are fabricated (the local match_result table is empty).
 *
 * The hover card's track list is fetched via a server function in the app; here
 * each playlist's real tracks are pre-seeded into a QueryClient so the card
 * resolves from cache (Ladle can't run server functions). The list scrolls; in
 * the real app it also paginates on scroll.
 */
export const FullExperience: Story = () => {
	// Seed each playlist's real tracks into the infinite-query cache so the hover
	// card resolves them without hitting the (unavailable) server function. Built
	// once per mount in a nested client, per the Ladle seeded-data convention.
	const [queryClient] = useState(() => {
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false, refetchOnWindowFocus: false },
			},
		});
		for (const [playlistId, tracks] of Object.entries(
			matchExperience.playlistTracks,
		)) {
			client.setQueryData(playlistKeys.tracks(playlistId), {
				pages: [{ tracks, nextCursor: null }],
				pageParams: [undefined],
			});
		}
		return client;
	});

	const [index, setIndex] = useState(0);
	const [addedTo, setAddedTo] = useState<string[]>([]);
	const [stats, setStats] = useState<CompletionStats>({
		totalItems: matchExperience.songs.length,
		itemsMatched: 0,
		totalAdditions: 0,
		dismissedCount: 0,
		skippedCount: 0,
	});

	const current = matchExperience.songs[index];
	const isComplete = index >= matchExperience.songs.length || !current;

	const recentSongs = matchExperience.songs.slice(0, index).map((s) => ({
		id: s.id,
		albumArtUrl: s.albumArtUrl,
		name: s.name,
		artist: s.artist,
	}));

	return (
		<QueryClientProvider client={queryClient}>
			<Matching
				currentReviewItem={
					isComplete || !current
						? null
						: { mode: "song" as const, song: current }
				}
				currentSuggestions={
					isComplete || !current
						? []
						: (matchExperience.matchesBySong[current.id] ?? []).map((p) => ({
								mode: "song" as const,
								playlist: p,
							}))
				}
				totalSongs={matchExperience.songs.length}
				offset={index}
				addedTo={addedTo}
				isComplete={isComplete}
				completionStats={stats}
				recentItems={recentSongs}
				onAdd={(playlistId) => {
					if (addedTo.includes(playlistId)) return;
					setAddedTo((prev) => [...prev, playlistId]);
					setStats((s) => ({
						...s,
						itemsMatched: s.itemsMatched + (addedTo.length === 0 ? 1 : 0),
						totalAdditions: s.totalAdditions + 1,
					}));
				}}
				onDismiss={() => {
					setStats((s) => ({ ...s, dismissedCount: s.dismissedCount + 1 }));
					setAddedTo([]);
					setIndex((i) => i + 1);
				}}
				onNext={() => {
					setStats((s) =>
						addedTo.length === 0
							? { ...s, skippedCount: s.skippedCount + 1 }
							: s,
					);
					setAddedTo([]);
					setIndex((i) => i + 1);
				}}
				onExit={() => setIndex(0)}
			/>
		</QueryClientProvider>
	);
};
FullExperience.meta = {
	description:
		"Real songs, playlists & tracks from the local DB — hover a match to preview its cover, intent & track list. Pairings/scores are faked.",
};

export const EmptyState: Story = () => (
	<Matching
		currentReviewItem={null}
		currentSuggestions={[]}
		totalSongs={0}
		offset={0}
		addedTo={[]}
		isComplete={false}
		completionStats={defaultCompletionStats}
		recentItems={[]}
		onAdd={() => {}}
		onDismiss={() => {}}
		onNext={() => {}}
		onExit={() => {}}
	/>
);

// F6 — named SongMode story: shows a single song-orientation review card with
// its playlist suggestions. Used to verify song-mode UI in visual review.
const SONG_MODE_SONG: SongForMatching = {
	id: "story-song-1",
	spotifyId: "sp-story-1",
	name: "Midnight City",
	artist: "M83",
	album: "Hurry Up, We're Dreaming",
	albumArtUrl: null,
	genres: ["dream pop", "shoegaze"],
	audioFeatures: { tempo: 105, energy: 0.82, valence: 0.74 },
	analysis: null,
};

export const SongMode: Story = () => {
	const first = matchingSongs[0];
	const song = first?.song ?? SONG_MODE_SONG;
	const playlists = first?.playlists ?? [];

	return (
		<Matching
			mode="song"
			currentReviewItem={{ mode: "song", song }}
			currentSuggestions={playlists.map((p) => ({
				mode: "song" as const,
				playlist: p,
			}))}
			totalSongs={matchingSongs.length || 1}
			offset={0}
			addedTo={[]}
			isComplete={false}
			completionStats={{
				totalItems: matchingSongs.length || 1,
				itemsMatched: 0,
				totalAdditions: 0,
				dismissedCount: 0,
				skippedCount: 0,
			}}
			recentItems={[]}
			onAdd={() => {}}
			onDismiss={() => {}}
			onNext={() => {}}
			onExit={() => {}}
		/>
	);
};
SongMode.meta = {
	description:
		"Song-mode review card: a song is the review subject; playlists are suggestions. fitScore comes from strictnessScore (fused_score ?? score), never reranker/ordering score.",
};

// F6 — named PlaylistMode story: shows a single playlist-orientation review
// card with song suggestions. Inline fixture because match-experience.json
// contains song-mode data only; playlist-mode card shapes were added in MSR-39.
const PLAYLIST_REVIEW_ITEM: PlaylistForMatching = {
	id: "story-pl-1",
	spotifyId: "sp-story-pl-1",
	name: "Late Night Drives",
	description: "Synth-heavy tracks for empty motorways at 2am.",
	imageUrl: null,
	trackCount: 34,
};

const PLAYLIST_MODE_SONGS: SongSuggestionRow[] = [
	{
		song: {
			id: "story-song-a",
			spotifyId: "sp-a",
			name: "Midnight City",
			artist: "M83",
			album: "Hurry Up, We're Dreaming",
			albumArtUrl: null,
			genres: ["dream pop", "shoegaze"],
			audioFeatures: null,
			analysis: null,
		},
		// fitScore = strictnessScore from captured pair — never reranker/ordering score (A5/E7)
		fitScore: 0.87,
	},
	{
		song: {
			id: "story-song-b",
			spotifyId: "sp-b",
			name: "Crystalised",
			artist: "The xx",
			album: "xx",
			albumArtUrl: null,
			genres: ["indie pop", "dream pop"],
			audioFeatures: null,
			analysis: null,
		},
		fitScore: 0.79,
	},
	{
		song: {
			id: "story-song-c",
			spotifyId: "sp-c",
			name: "Digital Love",
			artist: "Daft Punk",
			album: "Discovery",
			albumArtUrl: null,
			genres: ["electronic", "french house"],
			audioFeatures: null,
			analysis: null,
		},
		fitScore: 0.71,
	},
];

// Framed to match the real page: the route renders inside the app shell's
// <main className="flex-1 p-8">, so the bare story (especially in ?mode=preview)
// otherwise sits edge-to-edge and clips the left gutter, reading as "not real".
export const PlaylistMode: Story = () => (
	<div className="theme-bg min-h-dvh p-8">
		<Matching
			mode="playlist"
			currentReviewItem={{ mode: "playlist", playlist: PLAYLIST_REVIEW_ITEM }}
			currentSuggestions={PLAYLIST_MODE_SONGS.map((row) => ({
				mode: "playlist" as const,
				song: row.song,
				fitScore: row.fitScore,
			}))}
			totalSongs={3}
			offset={0}
			addedTo={[]}
			isComplete={false}
			completionStats={{
				totalItems: 3,
				itemsMatched: 0,
				totalAdditions: 0,
				dismissedCount: 0,
				skippedCount: 0,
			}}
			recentItems={[]}
			onAdd={() => {}}
			onDismiss={() => {}}
			onNext={() => {}}
			onExit={() => {}}
		/>
	</div>
);
PlaylistMode.meta = {
	description:
		"Playlist-mode review card: a playlist is the review subject; songs are suggestions with fitScore. The authoritative server path is presentMatchReviewItem — getMatchReviewItem returns unavailable for playlist items (known warming limitation, MSR-39).",
};
