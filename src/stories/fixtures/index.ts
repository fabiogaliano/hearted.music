import data from "./fixtures.json";
import type { LikedSong } from "@/features/liked-songs/types";
import type { DashboardProps, ActivityItem } from "@/features/dashboard/types";
import type { SongForMatching, Playlist } from "@/features/matching/types";

export const allLikedSongs: LikedSong[] = data.likedSongs as LikedSong[];
export const dashboardData: DashboardProps = data.dashboard as DashboardProps;

export const matchingSongs: Array<{
	song: SongForMatching;
	playlists: Playlist[];
}> = data.matchingSongs as Array<{
	song: SongForMatching;
	playlists: Playlist[];
}>;

export const sidebarData = data.sidebar;

/**
 * Simulate progressive enrichment by masking analysis/audio data
 * for songs beyond the `enrichedCount` threshold.
 */
export function simulateEnrichment(
	songs: LikedSong[],
	enrichedCount: number,
): LikedSong[] {
	return songs.map((song, i) => {
		if (i < enrichedCount) return song;

		return {
			...song,
			analysis: null,
			displayState: "pending",
			track: {
				...song.track,
				audio_features: null,
				genres: [],
			},
		};
	});
}

/**
 * Build dashboard stats from a partially enriched song list.
 */
export function simulateDashboard(
	songs: LikedSong[],
	enrichedCount: number,
	isRunning: boolean,
): DashboardProps {
	const analyzed = Math.min(enrichedCount, songs.length);
	const pct =
		songs.length > 0 ? Math.round((analyzed / songs.length) * 100) : 0;

	return {
		...dashboardData,
		stats: {
			...dashboardData.stats,
			totalSongs: songs.length,
			analyzedPercent: pct,
			reviewCount:
				enrichedCount >= songs.length ? dashboardData.stats.reviewCount : 0,
		},
		isEnrichmentRunning: isRunning,
		smoothAnalyzedPercent: pct,
		recentActivity: (dashboardData.recentActivity as ActivityItem[]).slice(
			0,
			Math.min(5, enrichedCount),
		),
	};
}
