/**
 * Transforms raw Supabase exports into typed component fixtures.
 * Run: bun src/stories/fixtures/build-fixtures.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));

const likedSongsRaw = read("liked-songs-raw.json");
const analysesRaw = read("song-analyses-raw.json");
const audioFeaturesRaw = read("audio-features-raw.json");
const matchResultsRaw = read("match-results-raw.json");
const playlistsRaw = read("playlists-raw.json");
const accountRaw = read("account-raw.json");

// Index analyses and audio features by song_id
const analysisMap = new Map<string, unknown>();
for (const a of analysesRaw) analysisMap.set(a.song_id, a);

const audioMap = new Map<string, unknown>();
for (const af of audioFeaturesRaw) audioMap.set(af.song_id, af);

// Build LikedSong[]
const likedSongs = likedSongsRaw.map((ls: any) => {
	const song = ls.song;
	const analysis = analysisMap.get(song.id) as any | undefined;
	const audio = audioMap.get(song.id) as any | undefined;

	return {
		liked_at: ls.liked_at,
		matching_status: null,
		track: {
			id: song.id,
			spotify_track_id: song.spotify_id,
			name: song.name,
			artist: song.artists?.[0] ?? "Unknown",
			artist_id: song.artist_ids?.[0] ?? null,
			artist_image_url: null,
			album: song.album_name ?? null,
			image_url: song.image_url ?? null,
			genres: song.genres ?? [],
			audio_features: audio
				? {
						tempo: audio.tempo ?? null,
						energy: audio.energy ?? null,
						valence: audio.valence ?? null,
					}
				: null,
		},
		analysis: analysis
			? {
					id: analysis.id,
					track_id: analysis.song_id,
					analysis: analysis.analysis,
					model_name: analysis.model,
					version: analysis.prompt_version,
					created_at: analysis.created_at,
				}
			: null,
		uiAnalysisStatus: analysis ? "analyzed" : "not_analyzed",
	};
});

// Build matching songs
const songMap = new Map<string, any>();
for (const ls of likedSongs) songMap.set(ls.track.id, ls);

const matchingSongs = matchResultsRaw
	.filter((mr: any) => songMap.has(mr.song_id))
	.slice(0, 10)
	.map((mr: any) => {
		const song = songMap.get(mr.song_id);
		return {
			song: {
				id: song.track.id,
				name: song.track.name,
				artist: song.track.artist,
				album: song.track.album,
				albumArtUrl: song.track.image_url,
				genres: song.track.genres,
				audioFeatures: song.track.audio_features,
				analysis: song.analysis?.analysis ?? null,
			},
			playlists: [
				{
					id: mr.playlist.id,
					name: mr.playlist.name,
					reason: "Strong thematic and sonic match",
					matchScore: mr.score,
				},
			],
		};
	});

// Build DashboardProps
const account = accountRaw[0];
const dashboardStats = {
	totalSongs: likedSongs.length,
	analyzedPercent: Math.round(
		(likedSongs.filter((s: any) => s.analysis).length / likedSongs.length) *
			100,
	),
	matchedCount: matchResultsRaw.length,
	playlistCount: playlistsRaw.length,
	reviewCount: Math.min(5, matchResultsRaw.length),
};

const recentActivity = likedSongs.slice(0, 5).map((s: any, i: number) => ({
	id: `activity-${i}`,
	timestamp: s.liked_at,
	type: i % 3 === 0 ? "matched" : "liked",
	songId: s.track.id,
	songName: s.track.name,
	artistName: s.track.artist,
	imageUrl: s.track.image_url,
	...(i % 3 === 0
		? {
				playlistId: playlistsRaw[0]?.id ?? "p1",
				playlistName: playlistsRaw[0]?.name ?? "My Playlist",
			}
		: {}),
}));

const dashboard = {
	displayName: account?.display_name ?? "User",
	stats: dashboardStats,
	recentActivity,
	matchPreviews: [],
	isEnrichmentRunning: false,
	smoothAnalyzedPercent: dashboardStats.analyzedPercent,
	lastSyncText: "Just now",
};

// Build sidebar props
const sidebar = {
	unsortedCount: dashboardStats.reviewCount,
	userName: account?.display_name ?? null,
	userPlan: "Free Plan",
};

// Write fixtures
const fixtures = {
	likedSongs,
	matchingSongs,
	dashboard,
	sidebar,
	playlists: playlistsRaw.map((p: any) => ({
		id: p.id,
		name: p.name,
		trackCount: p.song_count ?? 0,
		image: p.image_url ?? "",
		description: p.description ?? "",
		lastUpdated: "2d ago",
		flagged: false,
	})),
};

writeFileSync(join(DIR, "fixtures.json"), JSON.stringify(fixtures, null, 2));
console.log(
	`Wrote fixtures.json with ${likedSongs.length} songs, ${matchingSongs.length} matching songs`,
);
