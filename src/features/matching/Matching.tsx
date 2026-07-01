import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { CompletionScreen } from "./sections/CompletionScreen";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type {
	MatchingProps,
	MatchingSuggestion,
	Playlist,
	PlaylistForMatching,
	SongForMatching,
	SongSuggestionRow,
} from "./types";

export function Matching({
	currentReviewItem,
	currentSuggestions,
	totalSongs,
	offset,
	addedTo,
	isComplete,
	completionStats,
	recentItems,
	reconnectNeeded,
	navigationDisabled,
	mode = "playlist",
	onModeChange = () => {},
	onAdd,
	onDismissSuggestion,
	onDismiss,
	onNext,
	onPrevious,
	onExit,
}: MatchingProps) {
	if (isComplete) {
		return (
			<CompletionScreen
				stats={completionStats}
				items={recentItems}
				onExit={onExit}
			/>
		);
	}

	// Unwrap song-mode types for MatchingSession.
	const currentSong: SongForMatching | null =
		currentReviewItem?.mode === "song" ? currentReviewItem.song : null;

	// Unwrap playlist-mode review item for MatchingSession.
	const currentPlaylist: PlaylistForMatching | null =
		currentReviewItem?.mode === "playlist" ? currentReviewItem.playlist : null;

	const currentPlaylists: Playlist[] = currentSuggestions
		.filter(
			(s): s is Extract<MatchingSuggestion, { mode: "song" }> =>
				s.mode === "song",
		)
		.map((s) => s.playlist);

	const currentSongSuggestions: SongSuggestionRow[] = currentSuggestions
		.filter(
			(s): s is Extract<MatchingSuggestion, { mode: "playlist" }> =>
				s.mode === "playlist",
		)
		.map((s) => ({ song: s.song, fitScore: s.fitScore }));

	// Backstop: a null review item (e.g. a failed fetch) must never paint a blank
	// screen. The frozen-list walk shouldn't reach here, but if it does, fall
	// through to the completion view rather than rendering nothing.
	if (mode === "song" && !currentSong) {
		return (
			<CompletionScreen
				stats={completionStats}
				items={recentItems}
				onExit={onExit}
			/>
		);
	}
	if (mode === "playlist" && !currentPlaylist) {
		return (
			<CompletionScreen
				stats={completionStats}
				items={recentItems}
				onExit={onExit}
			/>
		);
	}

	// Header + session enter as one cohesive unit — the app's shared "whisper" fade
	// (Dashboard, onboarding, the completion screen). Kept snappy because this is a
	// working surface advanced through many times per session. The per-panel slide
	// is reserved for song-to-song swaps (AnimatePresence initial={false}), so it no
	// longer fires on mount and leaves the header looking frozen beside it.
	return (
		<StaggeredContent
			className="mx-auto w-full max-w-[min(1600px,100%)]"
			staggerDelay={0.05}
			initialDelay={0.04}
		>
			<MatchingHeader
				currentIndex={offset}
				totalSongs={totalSongs}
				mode={mode}
				disabled={navigationDisabled}
				onModeChange={onModeChange}
			/>

			{mode === "song" && currentSong ? (
				<MatchingSession
					mode="song"
					currentSong={currentSong}
					playlists={currentPlaylists}
					addedTo={addedTo}
					reconnectNeeded={reconnectNeeded}
					navigationDisabled={navigationDisabled}
					isLastItem={offset >= totalSongs - 1}
					animateReject
					onAdd={onAdd}
					onDismissSuggestion={onDismissSuggestion}
					onDismiss={onDismiss}
					onNext={onNext}
					onPrevious={offset > 0 ? onPrevious : undefined}
				/>
			) : mode === "playlist" && currentPlaylist ? (
				<MatchingSession
					mode="playlist"
					reviewItem={currentPlaylist}
					suggestions={currentSongSuggestions}
					addedTo={addedTo}
					reconnectNeeded={reconnectNeeded}
					navigationDisabled={navigationDisabled}
					isLastItem={offset >= totalSongs - 1}
					animateReject
					onAdd={onAdd}
					onDismissSuggestion={onDismissSuggestion}
					onDismiss={onDismiss}
					onNext={onNext}
					onPrevious={offset > 0 ? onPrevious : undefined}
				/>
			) : null}
		</StaggeredContent>
	);
}
