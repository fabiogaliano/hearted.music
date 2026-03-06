import type { Playlist, Song } from "@/lib/data/mock-data";

export interface MatchingState {
	currentIndex: number;
	addedTo: Record<number, number[]>;
	showMeaning: boolean;
	activeJourneyStep: number;
	songMetaVisible: boolean;
}

export interface CompletionStats {
	totalSongs: number;
	songsMatched: number;
	totalAdditions: number;
	skippedCount: number;
}

export interface MatchingSessionProps {
	currentSong: Song;
	playlists: Playlist[];
	state: MatchingState;
	onAdd: (playlistId: number) => void;
	onDiscard: () => void;
	onNext: () => void;
	onToggleDetails: () => void;
	onCloseDetails: () => void;
	onJourneyStepHover: (index: number) => void;
}

export interface CompletionScreenProps {
	stats: CompletionStats;
	onExit: () => void;
}

export interface MatchingHeaderProps {
	currentIndex: number;
	totalSongs: number;
}

export interface MatchingProps {
	onExit: () => void;
}
