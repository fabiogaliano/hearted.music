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
	reconnectNeeded,
	navigationDisabled,
	onAdd,
	onDismiss,
	onNext,
	onPrevious,
	onExit,
}: MatchingProps) {
	if (isComplete) {
		return (
			<CompletionScreen
				stats={completionStats}
				songs={recentSongs}
				onExit={onExit}
			/>
		);
	}

	// Backstop: a null song (e.g. a failed fetch) must never paint a blank screen.
	// The frozen-list walk shouldn't reach here, but if it does, fall through to
	// the completion view rather than rendering nothing.
	if (!currentSong) {
		return (
			<CompletionScreen
				stats={completionStats}
				songs={recentSongs}
				onExit={onExit}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingHeader currentIndex={offset} totalSongs={totalSongs} />

			<MatchingSession
				currentSong={currentSong}
				playlists={currentMatches}
				addedTo={addedTo}
				reconnectNeeded={reconnectNeeded}
				navigationDisabled={navigationDisabled}
				isLastSong={offset >= totalSongs - 1}
				onAdd={onAdd}
				onDismiss={onDismiss}
				onNext={onNext}
				onPrevious={offset > 0 ? onPrevious : undefined}
			/>
		</div>
	);
}
