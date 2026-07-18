/**
 * Activity Feed - Discriminated Union Pattern
 *
 * Each activity type has a `type` discriminator field that enables:
 * - Exhaustive switch statements with compile-time checking
 * - Type-specific fields (e.g., only MatchedActivity has playlistName)
 * - Easy extension: add new type to union + add render case
 */

import type { MatchViewMode } from "@/features/matching/types";

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
	// Orientation the review count reflects — drives the CTA's /match link and
	// noun so a playlist-first user isn't sent to song mode (A2).
	matchOrientation: MatchViewMode;
}

export interface MatchPreview {
	id: number;
	image: string;
	name: string;
	artist: string;
}

export interface DashboardProps {
	accountId: string;
	handle: string | null;
	// Linked Spotify identity of the account, for the extension account-conflict
	// banner (null before first sync — banner stays hidden then).
	linkedSpotifyId: string | null;
	accountDisplayName: string | null;
	recentActivity: ActivityItem[];
	matchPreviews: MatchPreview[];
	stats: DashboardStats;
	lastSyncText: string;
}
