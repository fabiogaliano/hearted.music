/**
 * On-demand playable YouTube sources for the instrumental review queue.
 *
 * The whole point of that review is a human deciding "vocals or not" — which
 * means listening, not squinting at an instrumentalness number. This resolves a
 * review's song to up to three playable YouTube sources for the embedded player:
 *
 *   1. If the audio-feature pipeline already matched the song to a YouTube video
 *      (audio_feature_source_review), reuse that match and its top alternates —
 *      the exact same sources the audio review queue plays, clip offsets included.
 *   2. Otherwise, run a live yt-dlp flat search (top 3) — the same search the
 *      backfill worker starts from, minus the hydrate/score/download machinery,
 *      because the operator's ear replaces the scorer here.
 *
 * The yt-dlp import is a documented product-import exception (like the two in
 * audio-feature-reviews.ts — see control-panel/README.md "Architecture"): the
 * search wrapper is battle-tested against YouTube's output shape and reimplementing
 * it here would just drift. Everything else is local SQL.
 *
 * Results are cached per review: a search costs seconds of yt-dlp time, and the
 * operator flipping J/K back and forth shouldn't re-search.
 */

import { Result } from "better-result";
import type { YoutubeCandidate } from "@/lib/integrations/youtube-audio/types";
import { searchYouTube } from "@/lib/integrations/youtube-audio/yt-dlp";
import { type AudioFeatureCandidate, asCandidates } from "./audio-candidates";
import { asNumberArray } from "./audio-feature-reviews";
import { cached } from "./cache";
import { read } from "./db";
import { HttpError } from "./http-error";

// The player's A/B switch stays legible with three chips; more is choice noise.
const MAX_SOURCES = 3;
// Search results for a released song are effectively static; long TTL so paging
// around the queue never re-runs yt-dlp for a song already looked up.
const CACHE_TTL_MS = 15 * 60_000;

export interface InstrumentalAudioSource {
	videoId: string;
	url: string;
	title: string | null;
	channel: string | null;
	durationSeconds: number | null;
}

export interface InstrumentalAudioResult {
	// "match": reusing the audio pipeline's accepted YouTube match; "search": live
	// yt-dlp lookup. The client labels the A/B chips differently per origin.
	origin: "match" | "search";
	searchQuery: string | null;
	// Clip offsets the matcher sampled (match origin only) — jump-past-the-intro
	// chips in the player.
	clipStarts: number[];
	sources: InstrumentalAudioSource[];
}

interface StoredMatch {
	videoId: string;
	title: string | null;
	channel: string | null;
	durationSeconds: number | null;
}

/**
 * The accepted match first, then the best non-rejected alternates — the same
 * selection buildAudioSources makes client-side for the audio review player.
 */
export function sourcesFromMatch(
	match: StoredMatch,
	candidates: AudioFeatureCandidate[],
): InstrumentalAudioSource[] {
	const sources: InstrumentalAudioSource[] = [
		{
			videoId: match.videoId,
			url: `https://www.youtube.com/watch?v=${match.videoId}`,
			title: match.title,
			channel: match.channel,
			durationSeconds: match.durationSeconds,
		},
	];
	const seen = new Set([match.videoId]);
	for (const c of candidates) {
		if (sources.length >= MAX_SOURCES) break;
		if (c.rejected || !c.videoId || seen.has(c.videoId)) continue;
		seen.add(c.videoId);
		sources.push({
			videoId: c.videoId,
			url: c.url,
			title: c.title,
			channel: c.channel,
			durationSeconds: c.durationSeconds,
		});
	}
	return sources;
}

export function sourcesFromSearch(
	candidates: YoutubeCandidate[],
): InstrumentalAudioSource[] {
	const sources: InstrumentalAudioSource[] = [];
	const seen = new Set<string>();
	for (const c of candidates) {
		if (sources.length >= MAX_SOURCES) break;
		if (!c.videoId || seen.has(c.videoId)) continue;
		seen.add(c.videoId);
		sources.push({
			videoId: c.videoId,
			url: c.url,
			title: c.title,
			channel: c.channel,
			durationSeconds: c.durationSeconds,
		});
	}
	return sources;
}

export type SearchFn = (query: string) => Promise<YoutubeCandidate[]>;

async function ytDlpSearch(query: string): Promise<YoutubeCandidate[]> {
	const result = await searchYouTube(query, MAX_SOURCES);
	if (Result.isError(result)) {
		throw new HttpError(
			502,
			`YouTube search failed (${result.error.code}). Is yt-dlp installed and current?`,
		);
	}
	return result.value;
}

export async function audioSourcesForInstrumentalReview(
	reviewId: string,
	search: SearchFn = ytDlpSearch,
): Promise<InstrumentalAudioResult> {
	const songRows = await read<{
		song_id: string;
		name: string | null;
		artist_label: string | null;
	}>(
		`select r.song_id, s.name,
			array_to_string(s.artists, ', ') as artist_label
		 from public.song_instrumental_review r
		 join public.song s on s.id = r.song_id
		 where r.id = $1`,
		[reviewId],
	);
	const song = songRows[0];
	if (!song) throw new HttpError(404, "Review not found.");

	return cached(
		`instrumental-audio:${song.song_id}`,
		async () => {
			const matchRows = await read<{
				youtube_video_id: string;
				youtube_title: string | null;
				youtube_channel: string | null;
				youtube_duration_seconds: string | number | null;
				clip_starts_seconds: unknown;
				candidates: unknown;
			}>(
				`select youtube_video_id, youtube_title, youtube_channel,
					youtube_duration_seconds, clip_starts_seconds, candidates
				 from public.audio_feature_source_review
				 where song_id = $1 and youtube_video_id is not null
				 order by created_at desc
				 limit 1`,
				[song.song_id],
			);
			const match = matchRows[0];
			if (match) {
				return {
					origin: "match" as const,
					searchQuery: null,
					clipStarts: asNumberArray(match.clip_starts_seconds),
					sources: sourcesFromMatch(
						{
							videoId: match.youtube_video_id,
							title: match.youtube_title,
							channel: match.youtube_channel,
							durationSeconds:
								match.youtube_duration_seconds == null
									? null
									: Number(match.youtube_duration_seconds),
						},
						asCandidates(match.candidates),
					),
				};
			}

			// Same query shape as the backfill worker's buildSearchQuery: primary
			// artist + title + "audio" biases results toward full-track uploads.
			const primaryArtist =
				(song.artist_label ?? "").split(",")[0]?.trim() ?? "";
			const name = song.name ?? "";
			let query = `${primaryArtist} ${name} audio`.trim();
			let sources = sourcesFromSearch(await search(query));

			// Lyric-less tracks often carry a " - Instrumental" / " - Live" /
			// " - New Version" suffix that can zero out the YouTube search entirely;
			// retry once with the suffix stripped before giving up.
			const stripped = name.replace(/\s+-\s+.*$/, "").trim();
			if (sources.length === 0 && stripped && stripped !== name) {
				query = `${primaryArtist} ${stripped} audio`.trim();
				sources = sourcesFromSearch(await search(query));
			}

			return {
				origin: "search" as const,
				searchQuery: query,
				clipStarts: [],
				sources,
			};
		},
		false,
		CACHE_TTL_MS,
	);
}
