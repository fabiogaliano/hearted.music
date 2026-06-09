/**
 * Activity Feed - Discriminated Union Pattern
 *
 * Each activity type has a `type` discriminator field that enables:
 * - Exhaustive switch statements with compile-time checking
 * - Type-specific fields (e.g., only MatchedActivity has playlistName)
 * - Easy extension: add new type to union + add render case
 */

interface ActivityBase {
	id: string;
	timestamp: string;
}

interface LikedActivity extends ActivityBase {
	type: "liked";
	songId: string;
	songName: string;
	artistName: string;
	imageUrl: string | null;
}

interface MatchedActivity extends ActivityBase {
	type: "matched";
	songId: string;
	songName: string;
	artistName: string;
	imageUrl: string | null;
	playlistId: string;
	playlistName: string;
}

export type ActivityItem = LikedActivity | MatchedActivity;

export interface DashboardStats {
	totalSongs: number;
	analyzedPercent: number;
	playlistCount: number;
	reviewCount: number;
}

export interface MatchPreview {
	id: number;
	image: string;
}

export interface DashboardProps {
	accountId: string;
	handle: string | null;
	recentActivity: ActivityItem[];
	matchPreviews: MatchPreview[];
	stats: DashboardStats;
	lastSyncText: string;
}
