import type { Story } from "@ladle/react";
import { useState } from "react";
import { Matching } from "./Matching";
import { matchingSongs } from "@/stories/fixtures";
import type { CompletionStats } from "./types";

const defaultCompletionStats: CompletionStats = {
	totalSongs: matchingSongs.length,
	songsMatched: 0,
	totalAdditions: 0,
	skippedCount: 0,
};

export const FirstSong: Story = () => {
	const first = matchingSongs[0];
	if (!first) return <div>No matching data</div>;

	return (
		<Matching
			currentSong={first.song}
			currentMatches={first.playlists}
			totalSongs={matchingSongs.length}
			offset={0}
			addedTo={[]}
			isComplete={false}
			completionStats={defaultCompletionStats}
			recentSongs={[]}
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
				currentSong={null}
				currentMatches={[]}
				totalSongs={matchingSongs.length}
				offset={index}
				addedTo={[]}
				isComplete={true}
				completionStats={stats}
				recentSongs={matchingSongs.slice(0, index).map((m) => ({
					id: m.song.id,
					albumArtUrl: m.song.albumArtUrl,
					name: m.song.name,
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
			currentSong={current.song}
			currentMatches={current.playlists}
			totalSongs={matchingSongs.length}
			offset={index}
			addedTo={addedTo}
			isComplete={false}
			completionStats={stats}
			recentSongs={matchingSongs.slice(0, index).map((m) => ({
				id: m.song.id,
				albumArtUrl: m.song.albumArtUrl,
				name: m.song.name,
			}))}
			onAdd={(playlistId) => {
				setAddedTo((prev) => [...prev, playlistId]);
				setStats((s) => ({
					...s,
					songsMatched: s.songsMatched + 1,
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

export const EmptyState: Story = () => (
	<Matching
		currentSong={null}
		currentMatches={[]}
		totalSongs={0}
		offset={0}
		addedTo={[]}
		isComplete={false}
		completionStats={defaultCompletionStats}
		recentSongs={[]}
		onAdd={() => {}}
		onDismiss={() => {}}
		onNext={() => {}}
		onExit={() => {}}
	/>
);
