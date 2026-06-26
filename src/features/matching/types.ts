/**
 * UI/route-layer toggle mode (B2). Distinct from MatchOrientation (domain/server).
 * Canonical URL: `/match` = song mode; `/match?mode=playlist` = playlist mode.
 */
export type MatchViewMode = "song" | "playlist";

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

// E11 — Playlist review subject shape (MSR-32 will fill full implementation)
export interface PlaylistForMatching {
	id: string;
	spotifyId: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	trackCount: number | null;
}

// E11 — Orientation-aware review item. The discriminant `mode` matches
// MatchViewMode values so callers can check mode once.
export type MatchingReviewItem =
	| { mode: "song"; song: SongForMatching }
	| { mode: "playlist"; playlist: PlaylistForMatching };

// E11 — Orientation-aware suggestion row (MSR-33 adds song-as-suggestion variant)
export type MatchingSuggestion = {
	mode: "song";
	playlist: Playlist;
};

// E12 — Generalized from ReviewedSong (same fields, orientation-neutral name)
export interface ReviewedItem {
	id: string;
	albumArtUrl?: string | null;
	name: string;
	artist: string;
}

// F4 seam — MSR-32 implements PlaylistReviewItemSection with this contract
export interface PlaylistReviewItemSectionProps {
	itemKey: string;
	reviewItem: PlaylistForMatching;
	/** False in the canned demo/walkthrough where playlist ids aren't real rows. */
	canLoadTracks?: boolean;
	suppressTransition?: boolean;
}

// F4 seam — MSR-33 implements SongSuggestionsSection with this contract
export interface SongSuggestionsSectionProps {
	itemKey: string;
	suggestions: SongForMatching[];
	addedTo: string[];
	navigationDisabled?: boolean;
	isLastItem?: boolean;
	suppressTransition?: boolean;
	onAdd: (suggestionId: string) => void;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
}

type MatchingSessionCommonProps = {
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
	onAdd: (suggestionId: string) => void;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
};

type SongModeSession = MatchingSessionCommonProps & {
	mode: "song";
	currentSong: SongForMatching;
	playlists: Playlist[];
};

// MSR-33 will add suggestions: SongForMatching[]
type PlaylistModeSession = MatchingSessionCommonProps & {
	mode: "playlist";
	reviewItem: PlaylistForMatching;
};

export type MatchingSessionProps = SongModeSession | PlaylistModeSession;

export interface CompletionStats {
	totalItems: number;
	itemsMatched: number;
	totalAdditions: number;
	dismissedCount: number;
	skippedCount: number;
}

export interface CompletionScreenProps {
	stats: CompletionStats;
	items: ReviewedItem[];
	onExit: () => void;
}

export interface MatchingHeaderProps {
	currentIndex: number;
	totalSongs: number;
	/** Current UI view mode — drives which toggle button has aria-pressed="true". */
	mode: MatchViewMode;
	/** Disables both toggle buttons during pending navigation or actions. */
	disabled?: boolean;
	/**
	 * Called when the user activates a mode button that differs from current mode.
	 * Activating the current mode is a no-op and never calls this.
	 */
	onModeChange: (mode: MatchViewMode) => void;
}

export interface MatchingProps {
	currentReviewItem: MatchingReviewItem | null;
	currentSuggestions: MatchingSuggestion[];
	totalSongs: number;
	offset: number;
	addedTo: string[];
	isComplete: boolean;
	completionStats: CompletionStats;
	recentItems: ReviewedItem[];
	reconnectNeeded?: boolean;
	navigationDisabled?: boolean;
	/** Current UI view mode threaded to MatchingHeader toggle. Defaults to 'song'. */
	mode?: MatchViewMode;
	/** Callback for toggle navigation. No-op default keeps completion/story renders safe. */
	onModeChange?: (mode: MatchViewMode) => void;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
	onExit: () => void;
}
