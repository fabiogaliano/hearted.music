export interface SongAnalysis {
	headline: string;
	compound_mood: string;
	mood_description: string;
	interpretation: string;
	themes: Array<{ name: string; description: string }>;
	journey: Array<{ section: string; mood: string; description: string }>;
	key_lines: Array<{ line: string; insight: string }>;
	sonic_texture: string;
}

export interface SongForMatching {
	id: string;
	name: string;
	artist: string;
	album: string | null;
	albumArtUrl?: string | null;
	genres: string[];
	audioFeatures?: {
		tempo: number | null;
		energy: number | null;
		valence: number | null;
	} | null;
	analysis: SongAnalysis | null;
}

export interface Playlist {
	id: string;
	name: string;
	reason: string;
	matchScore: number;
}

export interface MatchingState {
	songMetaVisible: boolean;
}

export interface CompletionStats {
	totalSongs: number;
	songsMatched: number;
	totalAdditions: number;
	skippedCount: number;
}

export interface MatchingSessionProps {
	currentSong: SongForMatching;
	playlists: Playlist[];
	addedTo: string[];
	state: MatchingState;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void;
	onNext: () => void;
}

export interface CompletionScreenProps {
	stats: CompletionStats;
	songs: Array<{ id: string; albumArtUrl?: string | null; name: string }>;
	onExit: () => void;
}

export interface MatchingHeaderProps {
	currentIndex: number;
	totalSongs: number;
}

export interface MatchingProps {
	currentSong: SongForMatching | null;
	currentMatches: Playlist[];
	totalSongs: number;
	offset: number;
	addedTo: string[];
	isComplete: boolean;
	completionStats: CompletionStats;
	recentSongs: Array<{ id: string; albumArtUrl?: string | null; name: string }>;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void;
	onNext: () => void;
	onExit: () => void;
}
