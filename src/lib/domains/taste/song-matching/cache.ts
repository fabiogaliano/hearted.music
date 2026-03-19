/**
 * Match context metadata computation.
 *
 * Computes context hash from songs, playlists, and config
 * for deduplication of matching runs.
 */

import { Result } from "better-result";
import {
	hashCandidateSet,
	hashMatchContext,
	hashMatchingConfig,
	hashPlaylistSet,
	stableStringify,
} from "@/lib/domains/enrichment/embeddings/hashing";
import { getModelBundleHash } from "@/lib/domains/enrichment/embeddings/versioning";
import { DEFAULT_MATCHING_CONFIG } from "./config";
import type {
	MatchingConfig,
	MatchingPlaylistProfile,
	MatchingSong,
} from "./types";

export async function computeMatchContextMetadata(
	songs: MatchingSong[],
	profiles: MatchingPlaylistProfile[],
	matchingConfig: Partial<MatchingConfig> = {},
): Promise<{
	contextHash: string;
	candidateSetHash: string;
	playlistSetHash: string;
	configHash: string;
	modelBundleHash: string;
	effectiveConfig: MatchingConfig;
}> {
	const effectiveConfig = { ...DEFAULT_MATCHING_CONFIG, ...matchingConfig };

	const songIds = songs.map((s) => s.id);
	const songContentHashes = songs.map((s) =>
		[s.name, s.artists.join(","), s.genres?.join(",") ?? ""].join("|"),
	);
	const candidateSetHash = await hashCandidateSet(songIds, songContentHashes);

	const playlistIds = profiles.map((p) => p.playlistId);
	const profileHashes = profiles.map((p) =>
		stableStringify({
			id: p.playlistId,
			genres: p.genreDistribution,
			audio: p.audioCentroid,
			emb: p.embedding
				? p.embedding.map((v) => Math.round(v * 10000) / 10000)
				: null,
		}),
	);
	const playlistSetHash = await hashPlaylistSet(playlistIds, profileHashes);

	const configHash = await hashMatchingConfig({
		weights: { ...effectiveConfig.weights } as any,
		audioWeights: { ...effectiveConfig.audioWeights } as any,
		minScoreThreshold: effectiveConfig.minScoreThreshold,
	});

	const modelBundleHashResult = await getModelBundleHash();
	if (Result.isError(modelBundleHashResult)) {
		throw modelBundleHashResult.error;
	}

	const contextHash = await hashMatchContext({
		candidateSetHash,
		playlistSetHash,
		configHash,
		modelBundleHash: modelBundleHashResult.value,
	});

	return {
		contextHash,
		candidateSetHash,
		playlistSetHash,
		configHash,
		modelBundleHash: modelBundleHashResult.value,
		effectiveConfig,
	};
}
