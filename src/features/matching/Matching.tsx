import { useEffect, useState } from "react";
import {
	loadLandingSongDetail,
	loadLandingSongsManifest,
	type LandingSongDetail,
} from "@/lib/data/landing-songs";
import { useMatchingState } from "./hooks/useMatchingState";

import { CompletionScreen } from "./sections/CompletionScreen";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type { CompletionStats, MatchingProps } from "./types";

const PLAYLISTS = [
	{
		id: 1,
		name: "crying in the car",
		matchScore: 0.94,
		reason: "for when you're driving and it hits you",
	},
	{
		id: 2,
		name: "sweaty and happy",
		matchScore: 0.89,
		reason: "movement that feels good",
	},
	{
		id: 3,
		name: "feeling everything",
		matchScore: 0.82,
		reason: "songs that meet you where you are",
	},
	{
		id: 4,
		name: "easy does it",
		matchScore: 0.45,
		reason: "a bit much for gentle mornings",
	},
];

export function Matching({ onExit }: MatchingProps) {
	const [songs, setSongs] = useState<LandingSongDetail[]>([]);

	useEffect(() => {
		loadLandingSongsManifest()
			.then((manifest) =>
				Promise.all(manifest.map((m) => loadLandingSongDetail(m.detailPath))),
			)
			.then(setSongs)
			.catch(() => setSongs([]));
	}, []);

	const {
		state,
		isComplete,
		handleAdd,
		handleNext,
		handleDismiss,
		handleShowDetails,
		handleHideDetails,
		handleJourneyStepHover,
	} = useMatchingState(songs.length);

	const currentSong = songs[state.currentIndex];

	const totalAdditions = Object.values(state.addedTo).reduce(
		(sum, arr) => sum + arr.length,
		0,
	);
	const songsMatched = Object.keys(state.addedTo).length;
	const completionStats: CompletionStats = {
		totalSongs: songs.length,
		songsMatched,
		totalAdditions,
		skippedCount: songs.length - songsMatched,
	};

	if (isComplete) {
		return (
			<CompletionScreen stats={completionStats} songs={songs} onExit={onExit} />
		);
	}

	if (!currentSong) return null;

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingHeader
				currentIndex={state.currentIndex}
				totalSongs={songs.length}
			/>

			<MatchingSession
				currentSong={currentSong}
				playlists={PLAYLISTS}
				state={state}
				onAdd={(playlistId: number) => handleAdd(playlistId, currentSong.id)}
				onDismiss={handleDismiss}
				onNext={handleNext}
				onToggleDetails={handleShowDetails}
				onCloseDetails={handleHideDetails}
				onJourneyStepHover={handleJourneyStepHover}
			/>
		</div>
	);
}
