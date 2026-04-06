/**
 * Types for Liked Songs feature
 *
 * Maps to TrackWithAnalysis from the API but with UI-specific additions
 */
import type { ThemeConfig } from "@/lib/theme/types";
import type { SongDisplayState } from "@/lib/domains/billing/state";

// Re-export the API types for convenience
export type MatchingStatus =
	| "pending"
	| "has_suggestions"
	| "acted"
	| "no_suggestions";
export interface LikedSong {
	liked_at: string;
	matching_status: MatchingStatus | null;
	track: {
		id: string;
		spotify_track_id: string;
		name: string;
		artist: string;
		artist_id: string | null;
		artist_image_url: string | null;
		album: string | null;
		image_url: string | null;
		genres: string[];
		audio_features: {
			tempo: number | null;
			energy: number | null;
			valence: number | null;
		} | null;
	};
	analysis: SongAnalysis | null;
	displayState: SongDisplayState;
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
	headline?: string;
	compound_mood?: string;
	mood_description?: string;
	interpretation?: string;
	themes?: Array<{
		name: string;
		confidence?: number;
		description: string;
	}>;
	journey?: Array<{
		section: string;
		mood: string;
		description: string;
	}>;
	key_lines?: Array<{
		line: string;
		insight: string;
	}>;
	sonic_texture?: string;
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
