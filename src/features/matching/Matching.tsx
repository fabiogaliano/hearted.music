import { playlists, songs } from "@/lib/data/mock-data";
import { useMatchingState } from "./hooks/useMatchingState";
import { CompletionScreen } from "./sections/CompletionScreen";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type { CompletionStats, MatchingProps } from "./types";

export function Matching({ onExit }: MatchingProps) {
	const {
		state,
		isComplete,
		handleAdd,
		handleNext,
		handleSkip,
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
		return <CompletionScreen stats={completionStats} onExit={onExit} />;
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingHeader
				currentIndex={state.currentIndex}
				totalSongs={songs.length}
			/>

			<MatchingSession
				currentSong={currentSong}
				playlists={playlists}
				state={state}
				onAdd={(playlistId: number) => handleAdd(playlistId, currentSong.id)}
				onDiscard={handleSkip}
				onNext={handleNext}
				onToggleDetails={handleShowDetails}
				onCloseDetails={handleHideDetails}
				onJourneyStepHover={handleJourneyStepHover}
			/>
		</div>
	);
}
