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

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";

/**
 * The nine scoring-relevant audio-feature columns, as embedded under song.
 * Every column is nullable; a present row (even all-null) still counts as
 * Phase-1 audio evidence for candidacy — see loadPhase1Candidates.
 */
interface EmbeddedAudioFeature {
	energy: number | null;
	valence: number | null;
	danceability: number | null;
	acousticness: number | null;
	instrumentalness: number | null;
	speechiness: number | null;
	liveness: number | null;
	tempo: number | null;
	loudness: number | null;
}

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
	af: EmbeddedAudioFeature,
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
 * A single embedded query fetches the account's active liked_song rows joined
 * to song and, nested under song, its one-to-one song_audio_feature row. Only
 * songs with Phase-1 enrichment (genres non-empty OR an audio-feature row) are
 * kept. No entitlement check — Phase-1 is ungated.
 *
 * The audio features are embedded through the FK rather than derived into an id
 * list and re-queried with `.in(...)`: DB-derived id sets must never re-enter a
 * query as a URL filter (see CLAUDE.md), and the join also saves a round-trip.
 *
 * We do NOT use `select_data_enriched_liked_song_ids` (requires song_analysis +
 * song_embedding) or `select_entitled_data_enriched_liked_song_ids` (adds
 * entitlement on top). Those RPCs gate on AI-phase data that free users never have.
 */
export async function loadPhase1Candidates(
	accountId: string,
): Promise<Phase1Candidate[]> {
	const supabase = createAdminSupabaseClient();

	const { data: likedRows, error: likedError } = await supabase
		.from("liked_song")
		.select(
			"song_id, liked_at, song:song_id ( id, spotify_id, name, artists, genres, image_url, duration_ms, language, language_secondary, vocal_gender, release_year, album_name, song_audio_feature ( energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness ) )",
		)
		.eq("account_id", accountId)
		.is("unliked_at", null);

	if (likedError) {
		throw new Error(
			`[candidate-loader] failed to load liked songs: ${likedError.message}`,
		);
	}

	if (!likedRows || likedRows.length === 0) return [];

	// Assemble candidates, keeping only Phase-1 enriched songs. A song qualifies
	// when it has non-empty genres OR an audio-feature row — either signal is
	// sufficient for the deterministic scorer.
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
			song_audio_feature: EmbeddedAudioFeature | EmbeddedAudioFeature[] | null;
		} | null;

		if (!song) continue;

		// PostgREST returns a to-one embed as an object, but tolerate an array in
		// case the relationship is ever detected as to-many.
		const af = Array.isArray(song.song_audio_feature)
			? (song.song_audio_feature[0] ?? null)
			: song.song_audio_feature;
		const hasGenres = Array.isArray(song.genres) && song.genres.length > 0;
		const hasAudio = af !== null && af !== undefined;

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
