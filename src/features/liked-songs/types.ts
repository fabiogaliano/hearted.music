/**
 * Types for Liked Songs feature
 *
 * Maps to TrackWithAnalysis from the API but with UI-specific additions
 */
import type { ThemeConfig } from "@/lib/theme/types";

// Re-export the API types for convenience
export type MatchingStatus = "pending" | "matched" | "ignored";
export type UIAnalysisStatus =
	| "not_analyzed"
	| "analyzing"
	| "analyzed"
	| "failed";

export interface LikedSong {
	liked_at: string;
	matching_status: MatchingStatus | null;
	track: {
		id: string;
		spotify_track_id: string;
		name: string;
		artist: string;
		artist_id: string | null;
		album: string | null;
		image_url: string | null;
	};
	analysis: SongAnalysis | null;
	uiAnalysisStatus: UIAnalysisStatus;
}

// Full analysis structure from the database
export interface SongAnalysis {
	id: string;
	track_id: string;
	analysis: AnalysisContent;
	model_name: string;
	version: number;
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

// Component props
export interface LikedSongsPageProps {
	songs?: LikedSong[];
	isLoading?: boolean;
}

export interface SongListProps {
	theme: ThemeConfig;
	songs: LikedSong[];
	selectedSongId: string | null;
	onSelectSong: (song: LikedSong) => void;
}

export interface SongDetailPanelProps {
	theme: ThemeConfig;
	song: LikedSong;
	onClose: () => void;
	onNext?: () => void;
	onPrevious?: () => void;
	hasNext?: boolean;
	hasPrevious?: boolean;
}

// Helper to check if a song is "new" (liked in last 7 days)
export function isNewSong(likedAt: string): boolean {
	const likedDate = new Date(likedAt);
	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
	return likedDate > sevenDaysAgo;
}

// Helper to format relative time
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
