/**
 * Phase-1 enriched candidate loader for the playlist creation preview engine.
 *
 * A "candidate" is an actively-liked song that has Phase-1 enrichment — i.e.
 * at least genres OR audio features are present. Entitlement is NOT required:
 * Phase-1 (audio features, genres) enriches all users; only analysis + embeddings
 * stay gated. This intentionally avoids both `select_data_enriched_liked_song_ids`
 * (which requires song_analysis AND song_embedding) and
 * `select_entitled_data_enriched_liked_song_ids` (which adds entitlement on top).
 * We query liked_song + song directly, and treat an audio-feature row OR non-empty
 * genres as sufficient evidence of Phase-1 completion.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { getBatch as getAudioFeaturesBatch } from "@/lib/domains/enrichment/audio-features/queries";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";

/** A Phase-1 enriched liked song hydrated for the preview engine. */
export interface Phase1Candidate {
	song: MatchingSong;
	filterMeta: SongFilterMetadata;
	/** Display-only fields that are not used by the scorer or filters. */
	display: {
		imageUrl: string | null;
		album: string | null;
		durationMs: number | null;
	};
}

/**
 * Map a DB audio feature row to the MatchingAudioFeatures shape.
 *
 * Null values are excluded by omission rather than set to 0 — the scoring
 * layer already handles undefined keys via its `songValue !== undefined`
 * guard in computeAudioFeatureScore.
 */
function toMatchingAudioFeatures(
	af: AudioFeature,
): MatchingAudioFeatures | null {
	const hasAnyFeature =
		af.energy !== null ||
		af.valence !== null ||
		af.danceability !== null ||
		af.acousticness !== null ||
		af.instrumentalness !== null ||
		af.speechiness !== null ||
		af.liveness !== null ||
		af.tempo !== null ||
		af.loudness !== null;

	if (!hasAnyFeature) return null;

	return {
		energy: af.energy ?? 0,
		valence: af.valence ?? 0,
		danceability: af.danceability ?? 0,
		acousticness: af.acousticness ?? 0,
		instrumentalness: af.instrumentalness ?? 0,
		speechiness: af.speechiness ?? 0,
		liveness: af.liveness ?? 0,
		tempo: af.tempo ?? 120,
		loudness: af.loudness ?? -10,
	};
}

/**
 * Load all Phase-1 enriched candidates for the account.
 *
 * Steps:
 * 1. Fetch the account's active liked_song rows joined to song, keeping only
 *    songs that have Phase-1 enrichment: genres non-empty OR a song_audio_feature
 *    row exists. No entitlement check — Phase-1 is ungated.
 * 2. Batch-fetch audio features for the retained IDs.
 * 3. Assemble into Phase1Candidate[], ready for filter + scoring.
 *
 * We do NOT use `select_data_enriched_liked_song_ids` (requires song_analysis +
 * song_embedding) or `select_entitled_data_enriched_liked_song_ids` (adds
 * entitlement on top). Those RPCs gate on AI-phase data that free users never have.
 */
export async function loadPhase1Candidates(
	accountId: string,
): Promise<Phase1Candidate[]> {
	const supabase = createAdminSupabaseClient();

	// Step 1 — Fetch active liked songs with their song data.
	// We pull every actively-liked song and will filter to Phase-1 enriched
	// below. Using a single query avoids a round-trip for IDs.
	const { data: likedRows, error: likedError } = await supabase
		.from("liked_song")
		.select(
			"song_id, liked_at, song:song_id ( id, spotify_id, name, artists, genres, image_url, duration_ms, language, language_secondary, vocal_gender, release_year, album_name )",
		)
		.eq("account_id", accountId)
		.is("unliked_at", null);

	if (likedError) {
		throw new Error(
			`[candidate-loader] failed to load liked songs: ${likedError.message}`,
		);
	}

	if (!likedRows || likedRows.length === 0) return [];

	// Collect all song IDs so we can batch-fetch audio features in one query.
	const allSongIds = likedRows.map((r) => r.song_id);

	// Step 2 — Batch-fetch audio features. A present row is the Phase-1 audio
	// signal; absence means only genre can drive scoring for that song.
	const audioResult = await getAudioFeaturesBatch(allSongIds);
	if (Result.isError(audioResult)) {
		throw new Error(
			`[candidate-loader] failed to load audio features: ${audioResult.error.message}`,
		);
	}
	const audioMap: Map<string, AudioFeature> = audioResult.value;

	// Step 3 — Assemble candidates, keeping only Phase-1 enriched songs.
	// A song qualifies when it has non-empty genres OR an audio-feature row —
	// either signal is sufficient for the deterministic scorer.
	const candidates: Phase1Candidate[] = [];
	for (const row of likedRows) {
		const song = row.song as {
			id: string;
			spotify_id: string;
			name: string;
			artists: string[] | null;
			genres: string[] | null;
			image_url: string | null;
			duration_ms: number | null;
			language: string | null;
			language_secondary: string | null;
			vocal_gender: string | null;
			release_year: number | null;
			album_name: string | null;
		} | null;

		if (!song) continue;

		const af = audioMap.get(song.id);
		const hasGenres = Array.isArray(song.genres) && song.genres.length > 0;
		const hasAudio = af !== undefined;

		// Exclude songs with no Phase-1 data at all — they cannot be scored.
		if (!hasGenres && !hasAudio) continue;

		const audioFeatures = af ? toMatchingAudioFeatures(af) : null;

		candidates.push({
			song: {
				id: song.id,
				spotifyId: song.spotify_id,
				name: song.name,
				artists: song.artists ?? [],
				genres: song.genres ?? [],
				audioFeatures: audioFeatures ?? null,
			},
			filterMeta: {
				language: song.language,
				languageSecondary: song.language_secondary,
				releaseYear: song.release_year,
				vocalGender: song.vocal_gender,
				likedAt: row.liked_at ? new Date(row.liked_at).getTime() : null,
			},
			display: {
				imageUrl: song.image_url,
				album: song.album_name,
				durationMs: song.duration_ms,
			},
		});
	}

	return candidates;
}
