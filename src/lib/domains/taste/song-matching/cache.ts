/**
 * Match snapshot metadata computation.
 *
 * Computes snapshot hash from songs, playlists, and config
 * for deduplication of matching runs.
 */

import { Result } from "better-result";
import {
	hashCandidateSet,
	hashExclusionSet,
	hashMatchSnapshot,
	hashMatchingConfig,
	hashPlaylistSet,
	hashRerankerConfig,
	stableStringify,
} from "@/lib/domains/enrichment/embeddings/hashing";
import { getModelBundleHash } from "@/lib/domains/enrichment/embeddings/versioning";
import { getMlProvider } from "@/lib/integrations/providers/factory";
import { DEFAULT_RERANKER_CONFIG } from "@/lib/integrations/reranker/service";
import { DEFAULT_MATCHING_CONFIG } from "./config";
import type {
	MatchingConfig,
	MatchingPlaylistProfile,
	MatchingSong,
} from "./types";

export async function computeMatchSnapshotMetadata(
	songs: MatchingSong[],
	profiles: MatchingPlaylistProfile[],
	matchingConfig: Partial<MatchingConfig> = {},
	exclusionSet?: Set<string>,
): Promise<{
	snapshotHash: string;
	candidateSetHash: string;
	playlistSetHash: string;
	configHash: string;
	exclusionSetHash?: string;
	rerankerConfigHash: string;
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

	const configHash = await hashMatchingConfig(
		effectiveConfig as unknown as Record<string, unknown>,
	);
	const exclusionSetHash =
		exclusionSet && exclusionSet.size > 0
			? await hashExclusionSet([...exclusionSet])
			: undefined;
	const providerResult = getMlProvider();
	const rerankerConfigHash = await hashRerankerConfig({
		model: Result.isOk(providerResult)
			? (providerResult.value.getMetadata().rerankerModel ?? null)
			: null,
		provider: Result.isOk(providerResult)
			? providerResult.value.getMetadata().name
			: null,
		config: DEFAULT_RERANKER_CONFIG,
	});

	const modelBundleHashResult = await getModelBundleHash();
	if (Result.isError(modelBundleHashResult)) {
		throw modelBundleHashResult.error;
	}

	const snapshotHash = await hashMatchSnapshot({
		candidateSetHash,
		playlistSetHash,
		configHash,
		exclusionSetHash,
		rerankerConfigHash,
		modelBundleHash: modelBundleHashResult.value,
	});

	return {
		snapshotHash,
		candidateSetHash,
		playlistSetHash,
		configHash,
		exclusionSetHash,
		rerankerConfigHash,
		modelBundleHash: modelBundleHashResult.value,
		effectiveConfig,
	};
}
