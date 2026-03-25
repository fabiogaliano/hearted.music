/**
 * Target-playlist match refresh orchestrator.
 *
 * The sole owner of match_context / match_result publication.
 * Re-reads current DB state on each pass (plan is a hint only).
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import { RerankerService } from "@/lib/integrations/reranker/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import * as songData from "@/lib/domains/library/songs/queries";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import { getDataEnrichedSongIds } from "@/lib/workflows/enrichment-pipeline/batch";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { rerankMatches } from "@/lib/workflows/enrichment-pipeline/reranking";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";
import { loadTargetPlaylistProfiles } from "./profiles";
import type { RefreshResult, TargetPlaylistRefreshPlan } from "./types";
import { writeEmptySnapshot, writeMatchSnapshot } from "./write-match-snapshot";

/**
 * Executes a single refresh pass against current DB state.
 * The plan is used only for optional work decisions (e.g. target-song enrichment).
 */
export async function executeRefresh(
	accountId: string,
	plan: TargetPlaylistRefreshPlan,
): Promise<RefreshResult> {
	let embeddingService: EmbeddingService;
	try {
		embeddingService = new EmbeddingService();
	} catch (err) {
		throw new Error(
			`[target-refresh] Failed to initialize EmbeddingService: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let llmService: LlmService | undefined;
	try {
		llmService = createLlmService();
	} catch {
		// LLM unavailable — cold-start expansion disabled
	}

	let rerankerService: RerankerService | undefined;
	try {
		rerankerService = new RerankerService();
	} catch {
		// Reranker unavailable
	}

	const profilingService = createPlaylistProfilingService(
		embeddingService,
		llmService,
	);

	// Optional: run lightweight enrichment for target-playlist-only songs
	if (plan.shouldEnrichTargetPlaylistSongs) {
		try {
			await runLightweightEnrichment({ accountId });
		} catch (err) {
			console.warn(
				"[target-refresh] Target-playlist-song enrichment failed, continuing:",
				err,
			);
		}
	}

	// Load current target playlist profiles (re-reads DB state)
	const { playlists, profiles } = await loadTargetPlaylistProfiles(
		accountId,
		profilingService,
	);

	// No target playlists → explicit empty snapshot
	if (playlists.length === 0) {
		return writeEmptySnapshot(accountId);
	}

	// Full-snapshot invariant: every target playlist must have a profile
	if (profiles.length !== playlists.length) {
		throw new Error(
			`[target-refresh] Profile count mismatch: ${profiles.length} profiles for ${playlists.length} target playlists`,
		);
	}

	// Load all data-enriched liked songs as candidates
	const songIds = await getDataEnrichedSongIds(accountId);

	// Zero candidates but playlists exist → publish zero-match snapshot
	if (songIds.length === 0) {
		return writeMatchSnapshot({
			accountId,
			songs: [],
			profiles,
			results: [],
			matchedSongIds: [],
		});
	}

	// Load song data
	const songsResult = await songData.getByIds(songIds);
	if (Result.isError(songsResult)) {
		throw new Error(
			`[target-refresh] Failed to load songs: ${songsResult.error.message}`,
		);
	}

	// Build matching songs with audio features
	const audioFeaturesResult = await audioFeatureData.getBatch(songIds);
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();

	const matchingSongs: MatchingSong[] = songsResult.value.map((song) => {
		const af = audioFeaturesMap.get(song.id);
		const audioFeatures: MatchingAudioFeatures | null = af
			? {
					energy: af.energy ?? 0,
					valence: af.valence ?? 0,
					danceability: af.danceability ?? 0,
					acousticness: af.acousticness ?? 0,
					instrumentalness: af.instrumentalness ?? 0,
					speechiness: af.speechiness ?? 0,
					liveness: af.liveness ?? 0,
					tempo: af.tempo ?? 0,
					loudness: af.loudness ?? 0,
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

	// Load exclusion set
	let exclusionSet: Set<string> | undefined;
	try {
		exclusionSet = await loadExclusionSet(accountId);
	} catch {
		console.warn("[target-refresh] Failed to load exclusion set");
	}

	// Get embeddings
	const embeddingsResult = await embeddingService.getEmbeddings(songIds);
	const songEmbeddings = new Map<string, number[]>();
	if (Result.isOk(embeddingsResult)) {
		for (const [id, emb] of embeddingsResult.value) {
			const parsed =
				typeof emb.embedding === "string"
					? (JSON.parse(emb.embedding) as number[])
					: emb.embedding;
			if (Array.isArray(parsed)) {
				songEmbeddings.set(id, parsed);
			}
		}
	}

	// Run matching
	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
	);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		profiles,
		songEmbeddings,
		exclusionSet ? { exclusionSet } : undefined,
	);

	if (Result.isError(matchResult)) {
		throw new Error("[target-refresh] Matching failed");
	}

	// Rerank
	if (rerankerService && matchResult.value.matches.size > 0) {
		await rerankMatches(
			matchResult.value.matches,
			matchingSongs,
			playlists,
			rerankerService,
		);
	}

	// Build result entries for atomic publish
	const matchedSongIds = [...matchResult.value.matches.keys()];
	const resultEntries: {
		song_id: string;
		playlist_id: string;
		score: number;
		rank: number | null;
		factors: Json;
	}[] = [];

	for (const [songId, results] of matchResult.value.matches) {
		for (const r of results) {
			resultEntries.push({
				song_id: songId,
				playlist_id: r.playlistId,
				score: r.score,
				rank: r.rank,
				factors: r.factors as unknown as Json,
			});
		}
	}

	return writeMatchSnapshot({
		accountId,
		songs: matchingSongs,
		profiles,
		results: resultEntries,
		matchedSongIds,
		exclusionSet,
	});
}
