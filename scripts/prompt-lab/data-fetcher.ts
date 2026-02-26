import { Result } from "better-result";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLyricsService } from "@/lib/capabilities/lyrics/service";
import { getLyricsFormatLegend } from "@/lib/capabilities/lyrics/utils/lyrics-formatter";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { createLastFmService } from "@/lib/integrations/lastfm/service";
import type { TestSong } from "./test-songs";

export interface SongData {
	song: TestSong;
	lyrics: string | null;
	audioFeaturesFormatted: string;
	genres: string[];
	errors: string[];
}

interface CachedData {
	artist: string;
	title: string;
	lyrics: string | null;
	audioFeatures: Record<string, number> | null;
	genres: string[];
	fetchedAt: string;
}

interface DataFetcherOptions {
	useCache: boolean;
	cacheDir: string;
}

export class DataFetcher {
	private cacheDir: string;
	private useCache: boolean;

	constructor(options: DataFetcherOptions) {
		this.cacheDir = join(options.cacheDir, "songs");
		this.useCache = options.useCache;

		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}
	}

	async fetchSongData(song: TestSong): Promise<SongData> {
		if (this.useCache) {
			const cached = this.readCache(song);
			if (cached) {
				return {
					song,
					lyrics: cached.lyrics
						? `${getLyricsFormatLegend()}\n${cached.lyrics}`
						: null,
					audioFeaturesFormatted: this.formatAudioFeatures(
						cached.audioFeatures,
					),
					genres: cached.genres,
					errors: [],
				};
			}
		}

		const errors: string[] = [];
		let rawLyrics: string | null = null;
		let audioFeatures: Record<string, number> | null = null;
		let genres: string[] = [];

		rawLyrics = await this.fetchLyrics(song, errors);
		audioFeatures = await this.fetchAudioFeatures(song, errors);
		genres = await this.fetchGenres(song, errors);

		this.writeCache(song, {
			artist: song.artist,
			title: song.title,
			lyrics: rawLyrics,
			audioFeatures,
			genres,
			fetchedAt: new Date().toISOString(),
		});

		return {
			song,
			lyrics: rawLyrics
				? `${getLyricsFormatLegend()}\n${rawLyrics}`
				: null,
			audioFeaturesFormatted: this.formatAudioFeatures(audioFeatures),
			genres,
			errors,
		};
	}

	private async fetchLyrics(
		song: TestSong,
		errors: string[],
	): Promise<string | null> {
		const serviceResult = createLyricsService();
		if (Result.isError(serviceResult)) {
			errors.push(`Lyrics: ${serviceResult.error.message}`);
			return null;
		}

		const result = await serviceResult.value.getLyricsText(
			song.artist,
			song.title,
		);
		if (Result.isError(result)) {
			errors.push(`Lyrics: ${result.error.message}`);
			return null;
		}

		return result.value;
	}

	private async fetchAudioFeatures(
		song: TestSong,
		errors: string[],
	): Promise<Record<string, number> | null> {
		if (!song.spotifyTrackId) {
			errors.push("Audio: No Spotify track ID provided");
			return null;
		}

		const service = createReccoBeatsService();
		const result = await service.getAudioFeatures(song.spotifyTrackId);
		if (Result.isError(result)) {
			errors.push(`Audio: ${result.error.message}`);
			return null;
		}

		if (!result.value) {
			errors.push("Audio: Track not found in ReccoBeats");
			return null;
		}

		return result.value as unknown as Record<string, number>;
	}

	private async fetchGenres(
		song: TestSong,
		errors: string[],
	): Promise<string[]> {
		const serviceResult = createLastFmService();
		if (!serviceResult || Result.isError(serviceResult)) {
			errors.push("Genres: Last.fm service not available");
			return [];
		}

		const result = await serviceResult.value.getTagsWithFallback(
			song.artist,
			song.title,
			song.album,
		);
		if (Result.isError(result)) {
			errors.push(`Genres: ${result.error.message}`);
			return [];
		}

		return result.value?.tags ?? [];
	}

	private formatAudioFeatures(
		features: Record<string, number> | null,
	): string {
		if (!features) {
			return "Audio features not available - analyze based on lyrics only";
		}

		return `Tempo: ${features.tempo ?? "unknown"} BPM
Energy: ${features.energy ?? "unknown"} (0.0 = low, 1.0 = high)
Valence: ${features.valence ?? "unknown"} (0.0 = sad/negative, 1.0 = happy/positive)
Danceability: ${features.danceability ?? "unknown"} (0.0 = not danceable, 1.0 = very danceable)
Acousticness: ${features.acousticness ?? "unknown"} (0.0 = not acoustic, 1.0 = acoustic)
Instrumentalness: ${features.instrumentalness ?? "unknown"} (0.0 = vocal, 1.0 = instrumental)
Liveness: ${features.liveness ?? "unknown"} (0.0 = studio, 1.0 = live performance)
Speechiness: ${features.speechiness ?? "unknown"} (0.0 = non-speech, 1.0 = speech-like)
Loudness: ${features.loudness ?? "unknown"} dB`;
	}

	private getCachePath(song: TestSong): string {
		const key = `${song.artist}--${song.title}`
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-");
		return join(this.cacheDir, `${key}.json`);
	}

	private readCache(song: TestSong): CachedData | null {
		const path = this.getCachePath(song);
		try {
			if (existsSync(path)) {
				return JSON.parse(readFileSync(path, "utf-8")) as CachedData;
			}
		} catch {
			// Cache miss or corrupt file
		}
		return null;
	}

	private writeCache(song: TestSong, data: CachedData): void {
		const path = this.getCachePath(song);
		try {
			writeFileSync(path, JSON.stringify(data, null, 2));
		} catch {
			// Non-fatal
		}
	}
}
