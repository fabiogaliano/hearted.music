interface SongAnalysis {
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
	spotifyId: string;
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
	spotifyId: string;
	name: string;
	reason: string;
	matchScore: number;
	/** Playlist cover — the recognition aid in the match row. Null → ♫ placeholder. */
	imageUrl: string | null;
	/** Total tracks in the playlist; drives the hover preview's "+ N more" tail. */
	songCount: number | null;
}

export interface CompletionStats {
	totalSongs: number;
	songsMatched: number;
	totalAdditions: number;
	dismissedCount: number;
	skippedCount: number;
}

/** A song the user reviewed this session — shown in the completion recap. */
export interface ReviewedSong {
	id: string;
	albumArtUrl?: string | null;
	name: string;
	artist: string;
}

export interface MatchingSessionProps {
	currentSong: SongForMatching;
	playlists: Playlist[];
	addedTo: string[];
	isDemo?: boolean;
	realAvailable?: boolean;
	reconnectNeeded?: boolean;
	navigationDisabled?: boolean;
	isLastSong?: boolean;
	/** Play the Tinder-style fly-off when the user rejects. The walkthrough leaves
	 *  this off: there, reject ends the rehearsal rather than advancing a song. */
	animateReject?: boolean;
	onRefresh?: () => void;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
}

export interface CompletionScreenProps {
	stats: CompletionStats;
	songs: ReviewedSong[];
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
	recentSongs: ReviewedSong[];
	reconnectNeeded?: boolean;
	navigationDisabled?: boolean;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
	onExit: () => void;
}
