import { useMatchingState } from "./hooks/useMatchingState";

import { CompletionScreen } from "./sections/CompletionScreen";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type { MatchingProps } from "./types";

export function Matching({
	currentSong,
	currentMatches,
	totalSongs,
	offset,
	addedTo,
	isComplete,
	completionStats,
	recentSongs,
	onAdd,
	onDismiss,
	onNext,
	onExit,
}: MatchingProps) {
	const { state } = useMatchingState();

	if (isComplete) {
		return (
			<CompletionScreen
				stats={completionStats}
				songs={recentSongs}
				onExit={onExit}
			/>
		);
	}

	if (!currentSong) return null;

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingHeader currentIndex={offset} totalSongs={totalSongs} />

			<MatchingSession
				currentSong={currentSong}
				playlists={currentMatches}
				addedTo={addedTo}
				state={state}
				onAdd={onAdd}
				onDismiss={onDismiss}
				onNext={onNext}
			/>
		</div>
	);
}
