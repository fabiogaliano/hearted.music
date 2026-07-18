import type { ActivityItem, DashboardProps } from "@/features/dashboard/types";
import type { LikedSong } from "@/features/liked-songs/types";
import type { Playlist, SongForMatching } from "@/features/matching/types";
import type { PlaylistTrack } from "@/lib/server/playlists.functions";
import data from "./fixtures.json";
import matchExperienceData from "./match-experience.json";

export const allLikedSongs: LikedSong[] = data.likedSongs as LikedSong[];
// The JSON fixture predates the extension account-conflict props; supply them
// in simulateDashboard rather than duplicating them across the fixture file.
const dashboardData = data.dashboard as Omit<
	DashboardProps,
	"accountId" | "linkedSpotifyId" | "accountDisplayName"
>;

export const matchingSongs: Array<{
	song: SongForMatching;
	playlists: Playlist[];
}> = data.matchingSongs as unknown as Array<{
	song: SongForMatching;
	playlists: Playlist[];
}>;

export const sidebarData = data.sidebar;

/**
 * Real data for the full /match experience story: real songs, real playlists
 * (covers, descriptions) and real per-playlist track membership pulled from the
 * local DB by scripts/fixtures/export-match-experience.ts. Only the song→playlist
 * pairings and scores are fabricated (the local match_result table is empty).
 */
export const matchExperience = matchExperienceData as unknown as {
	songs: SongForMatching[];
	matchesBySong: Record<string, Playlist[]>;
	playlistTracks: Record<string, PlaylistTrack[]>;
};

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
 * `isRunning` is retained for story API parity; the live "analyzing" label is
 * now driven by `useActiveJobs(accountId)` reading React Query. To exercise
 * that branch in stories, seed the query client via a Ladle decorator.
 */
export function simulateDashboard(
	songs: LikedSong[],
	enrichedCount: number,
	_isRunning: boolean,
): DashboardProps {
	const analyzed = Math.min(enrichedCount, songs.length);
	const pct =
		songs.length > 0 ? Math.round((analyzed / songs.length) * 100) : 0;

	return {
		...dashboardData,
		accountId: "story-account",
		linkedSpotifyId: "story-spotify-id",
		accountDisplayName: "story",
		stats: {
			...dashboardData.stats,
			totalSongs: songs.length,
			analyzedPercent: pct,
			reviewCount:
				enrichedCount >= songs.length ? dashboardData.stats.reviewCount : 0,
		},
		recentActivity: (dashboardData.recentActivity as ActivityItem[]).slice(
			0,
			Math.min(5, enrichedCount),
		),
	};
}
