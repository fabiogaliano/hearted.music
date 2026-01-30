/**
 * Types for Liked Songs feature
 *
 * Maps DB types to UI-friendly structures with analysis data.
 */

export type SortingStatus = "unsorted" | "sorted" | "ignored";
export type UIAnalysisStatus =
	| "not_analyzed"
	| "analyzing"
	| "analyzed"
	| "failed";

export type FilterOption = "all" | "unsorted" | "sorted" | "analyzed";

export interface LikedSongTrack {
	id: string;
	spotify_id: string;
	name: string;
	artist: string;
	album: string | null;
	image_url: string | null;
}

export interface LikedSong {
	id: string;
	liked_at: string;
	sorting_status: SortingStatus | null;
	track: LikedSongTrack;
	analysis: SongAnalysisData | null;
	uiAnalysisStatus: UIAnalysisStatus;
}

export interface SongAnalysisData {
	id: string;
	song_id: string;
	analysis: AnalysisContent;
	model: string;
	created_at: string | null;
}

export interface AnalysisContent {
	meaning?: {
		themes?: Array<{
			name: string;
			confidence: number;
			description: string;
		}>;
		interpretation?: {
			metaphors?: Array<{
				text: string;
				meaning: string;
			}>;
			deeper_meaning?: string;
			surface_meaning?: string;
			cultural_significance?: string;
		};
	};
	emotional?: {
		energy?: number;
		valence?: number;
		intensity?: number;
		dominant_mood?: string;
		mood_description?: string;
		journey?: Array<{
			mood: string;
			section: string;
			description: string;
		}>;
	};
	context?: {
		audience?: {
			resonates_with?: string[];
			universal_appeal?: number;
			primary_demographic?: string;
		};
		best_moments?: string[];
		listening_contexts?: Record<string, number>;
	};
	musical_style?: {
		vocal_style?: string;
		genre_primary?: string;
		sonic_texture?: string;
		production_style?: string;
	};
	audio_features?: {
		tempo?: number;
		energy?: number;
		valence?: number;
		liveness?: number;
		loudness?: number;
		speechiness?: number;
		acousticness?: number;
		danceability?: number;
		instrumentalness?: number;
	};
	matching_profile?: {
		theme_cohesion?: number;
		mood_consistency?: number;
		sonic_similarity?: number;
		energy_flexibility?: number;
	};
}

export interface LikedSongsPageProps {
	songs: LikedSong[];
	initialFilter: FilterOption;
	selectedSlug: string | null;
	isLoading?: boolean;
}

export interface SongCardProps {
	song: LikedSong;
	albumArtUrl?: string;
	isSelected: boolean;
	isFocused?: boolean;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	isAnimatingTo?: boolean;
}

export interface SongDetailPanelProps {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	startRect: {
		top: number;
		left: number;
		width: number;
		height: number;
	} | null;
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	isDark?: boolean;
}

export function isNewSong(likedAt: string): boolean {
	const likedDate = new Date(likedAt);
	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
	return likedDate > sevenDaysAgo;
}

export function formatRelativeTime(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return `${diffDays} days ago`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
	return `${Math.floor(diffDays / 365)} years ago`;
}

export function generateSongSlug(artist: string, name: string): string {
	const combined = `${artist}-${name}`;
	return combined
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 100);
}
