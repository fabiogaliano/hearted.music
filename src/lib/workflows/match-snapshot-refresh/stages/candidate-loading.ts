/**
 * Candidate loading stage — resolves the entitled, data-enriched candidate
 * song set for an account, then assembles everything matching needs from it:
 * song rows + audio features (MatchingSong[]), the base exclusion set
 * (already-decided pairs + songs already in a target playlist), and song
 * embeddings.
 *
 * Split into three functions rather than one because the orchestrator needs
 * to report progress and check for supersession between the song-id count
 * (cheap) and the full detail load (expensive) — see matching/overview.md's
 * candidate_loading stage.
 */

import { Result } from "better-result";
import { getBatch } from "@/lib/domains/enrichment/audio-features/queries";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getByIds } from "@/lib/domains/library/songs/queries";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import { log } from "@/lib/observability/logger";
import { getEntitledDataEnrichedSongIds } from "@/lib/workflows/enrichment-pipeline/batch";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";

export async function loadCandidateSongIds(
	accountId: string,
): Promise<string[]> {
	return getEntitledDataEnrichedSongIds(accountId);
}

export interface CandidateDetails {
	matchingSongs: MatchingSong[];
	baseExclusionSet: Set<string>;
}

export async function loadCandidateDetails(
	accountId: string,
	songIds: string[],
	who: string,
): Promise<CandidateDetails> {
	const songsResult = await getByIds(songIds);
	if (Result.isError(songsResult)) {
		throw new Error(
			`[target-refresh] Failed to load songs: ${songsResult.error.message}`,
		);
	}

	const audioFeaturesResult = await getBatch(songIds);
	if (Result.isError(audioFeaturesResult)) {
		// Don't silently degrade every song to audio-feature-absent matching —
		// surface the DB failure so a systemic outage is visible in the logs.
		log.warn("match:audio-features-degraded", {
			actor: who,
			songs: songIds.length,
			error: audioFeaturesResult.error.message,
		});
	}
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();

	const matchingSongs: MatchingSong[] = songsResult.value.map((song) => {
		const audioFeatureRow = audioFeaturesMap.get(song.id);
		const audioFeatures: MatchingAudioFeatures | null = audioFeatureRow
			? {
					energy: audioFeatureRow.energy ?? 0,
					valence: audioFeatureRow.valence ?? 0,
					danceability: audioFeatureRow.danceability ?? 0,
					acousticness: audioFeatureRow.acousticness ?? 0,
					instrumentalness: audioFeatureRow.instrumentalness ?? 0,
					speechiness: audioFeatureRow.speechiness ?? 0,
					liveness: audioFeatureRow.liveness ?? 0,
					tempo: audioFeatureRow.tempo ?? 0,
					loudness: audioFeatureRow.loudness ?? 0,
				}
			: null;

		return {
			id: song.id,
			spotifyId: song.spotify_id,
			name: song.name,
			artists: song.artists,
			genres: song.genres,
			audioFeatures,
		};
	});

	// Base exclusions only: pairs the user already decided on plus songs already
	// in a target playlist. Safe metadata hard filters (language, vocal gender,
	// release year, liked-at) are deliberately NOT applied here — they are
	// read-time predicates in visible-suggestion-list.ts (Phase 9 / MSR-36/37), so
	// loosening a filter reveals pairs from the already-stored snapshot without a
	// recompute. Applying them at write time would drop those pairs before storage
	// and make loosening impossible, so the snapshot keeps the broad candidate set.
	let baseExclusionSet: Set<string> = new Set();
	const baseResult = await loadExclusionSet(accountId).catch(
		(err: unknown) => err,
	);

	if (baseResult instanceof Error || !(baseResult instanceof Set)) {
		log.warn("match:exclusion-set-failed", {
			actor: who,
			error:
				baseResult instanceof Error ? baseResult.message : String(baseResult),
		});
	} else {
		baseExclusionSet = baseResult;
	}

	return { matchingSongs, baseExclusionSet };
}

export async function loadSongEmbeddings(
	embeddingService: EmbeddingService,
	songIds: string[],
	who: string,
): Promise<Map<string, number[]>> {
	const embeddingsResult = await embeddingService.getEmbeddings(songIds);
	const songEmbeddings = new Map<string, number[]>();
	if (Result.isOk(embeddingsResult)) {
		for (const [songId, embeddingRow] of embeddingsResult.value) {
			let parsedEmbedding: unknown;
			try {
				parsedEmbedding =
					typeof embeddingRow.embedding === "string"
						? JSON.parse(embeddingRow.embedding)
						: embeddingRow.embedding;
			} catch (error) {
				// A single corrupt/partially-written embedding string must not throw
				// and crash the whole refresh — skip the row, keep the rest usable.
				log.warn("match:embedding-parse-failed", {
					actor: who,
					songId,
					error: error instanceof Error ? error.message : String(error),
				});
				continue;
			}
			if (
				Array.isArray(parsedEmbedding) &&
				parsedEmbedding.every((value) => typeof value === "number")
			) {
				songEmbeddings.set(songId, parsedEmbedding);
			}
		}
	}
	return songEmbeddings;
}
