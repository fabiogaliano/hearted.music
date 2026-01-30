/**
 * Dashboard feature type definitions
 */

import type { ThemeColor } from "@/lib/theme/types";

export interface HomeStats {
	totalSongs: number;
	analyzedPercent: number;
	matchedCount: number;
	playlistCount: number;
	newSongsCount: number;
}

export interface DashboardPlaylist {
	id: string;
	name: string;
	songCount: number | null;
	imageUrl: string | null;
}

export interface RecentActivityItem {
	id: string;
	song: string;
	artist: string;
	playlist: string;
	time: string;
	image: string;
}

export interface DashboardLoaderData {
	theme: ThemeColor | null;
	stats: HomeStats;
	playlists: DashboardPlaylist[];
	recentActivity: RecentActivityItem[];
	userName: string;
}

export type NavItem = "home" | "match" | "liked" | "playlists" | "settings";
