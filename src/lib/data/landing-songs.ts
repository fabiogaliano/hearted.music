import type { LikedSong } from "@/features/liked-songs/types";

const MANIFEST_PATH = "/landing-songs/index.json";

export interface LandingSongManifest {
	id: number;
	spotifyTrackId: string;
	name: string;
	artist: string;
	album: string;
	albumArtUrl: string;
	artistImageUrl?: string;
	spotifyArtistId: string;
	genres: string[];
	detailPath: string;
}

export interface LandingSongAudioFeatures {
	tempo: number | null;
	energy: number | null;
	valence: number | null;
}

export interface LandingSongAnalysis {
	headline: string;
	compound_mood: string;
	mood_description: string;
	interpretation: string;
	themes: Array<{ name: string; description: string }>;
	journey: Array<{ section: string; mood: string; description: string }>;
	key_lines: Array<{ line: string; insight: string }>;
	sonic_texture: string;
}

export interface LandingSongDetail
	extends Omit<LandingSongManifest, "detailPath"> {
	genres: string[];
	audioFeatures: LandingSongAudioFeatures;
	analysis: LandingSongAnalysis;
}

export type LandingSongForUI = LandingSongManifest | LandingSongDetail;

interface LandingSongsManifestFile {
	generatedAt?: string;
	songs: LandingSongManifest[];
}

function isLandingSongDetail(
	song: LandingSongForUI,
): song is LandingSongDetail {
	return "analysis" in song;
}

function toLikedSongAnalysis(
	detail: LandingSongDetail,
): NonNullable<LikedSong["analysis"]> {
	return {
		id: `mock-${detail.spotifyTrackId}`,
		track_id: detail.spotifyTrackId,
		analysis: {
			headline: detail.analysis.headline,
			compound_mood: detail.analysis.compound_mood,
			mood_description: detail.analysis.mood_description,
			interpretation: detail.analysis.interpretation,
			themes: detail.analysis.themes,
			journey: detail.analysis.journey,
			key_lines: detail.analysis.key_lines,
			sonic_texture: detail.analysis.sonic_texture,
		},
		model_name: "gemini-2.5-flash",
		version: 1,
		created_at: null,
	};
}

export function toLikedSong(song: LandingSongForUI): LikedSong {
	const detail = isLandingSongDetail(song) ? song : null;
	const audioFeatures = detail?.audioFeatures ?? {
		tempo: null,
		energy: null,
		valence: null,
	};

	return {
		liked_at: new Date().toISOString(),
		matching_status: null,
		track: {
			id: song.spotifyTrackId,
			spotify_track_id: song.spotifyTrackId,
			name: song.name,
			artist: song.artist,
			artist_id: song.spotifyArtistId,
			album: song.album,
			image_url: song.albumArtUrl,
			genres: song.genres ?? [],
			audio_features: audioFeatures,
		},
		analysis: detail ? toLikedSongAnalysis(detail) : null,
		uiAnalysisStatus: detail ? "analyzed" : "analyzing",
	};
}

function resolveAssetPath(path: string): string {
	const baseUrl = import.meta.env.BASE_URL ?? "/";
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return `${normalizedBase}${normalizedPath}`;
}

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(resolveAssetPath(path), { cache: "default" });
	if (!response.ok) {
		throw new Error(`Failed to fetch ${path}: ${response.status}`);
	}
	return (await response.json()) as T;
}

export async function loadLandingSongsManifest(): Promise<
	LandingSongManifest[]
> {
	const data = await fetchJson<
		LandingSongManifest[] | LandingSongsManifestFile
	>(MANIFEST_PATH);
	return Array.isArray(data) ? data : data.songs;
}

export async function loadLandingSongDetail(
	detailPath: string,
): Promise<LandingSongDetail> {
	return fetchJson<LandingSongDetail>(detailPath);
}
