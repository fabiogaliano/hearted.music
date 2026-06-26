import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { playlistKeys } from "@/features/playlists/queries";
import { matchExperience, matchingSongs } from "@/stories/fixtures";
import { Matching } from "./Matching";
import type { CompletionStats } from "./types";

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
