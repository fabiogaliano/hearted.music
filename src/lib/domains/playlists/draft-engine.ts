/**
 * Pure domain logic for the playlist creation preview engine.
 *
 * All functions here are stateless and side-effect-free (no DB writes, no
 * persisted profiles, no snapshot rows). They take in-memory data and return
 * ranked SongVM lists. Server orchestration (DB reads, auth context) lives in
 * playlist-draft.functions.ts; this module is the testable core.
 */

import { Result } from "better-result";
import { passesAllMatchFilters } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { blendGenreDistribution } from "@/lib/domains/taste/playlist-profiling/calculations";
import type { GenreDistribution } from "@/lib/domains/taste/playlist-profiling/types";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingPlaylistProfile,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import type { Phase1Candidate } from "./candidate-loader";
import type { SongVM } from "./types";

/**
 * A transient (never-persisted) playlist profile for the draft engine.
 * Mirrors MatchingPlaylistProfile but without a real playlist ID.
 */
interface TransientProfile {
	genreDistribution: GenreDistribution;
	audioCentroid: Record<string, number>;
	/** Query embedding — present only on the intent/premium path. */
	embedding: number[] | null;
	hasGenrePills: boolean;
}

// Synthetic playlist ID for the scoring pass. The draft engine scores every
// candidate against a single transient profile, so the ID is only needed to
// satisfy the MatchingPlaylistProfile interface — it is never stored or returned.
const DRAFT_PLAYLIST_ID = "__draft__";

/**
 * Apply hard match-filters to reduce candidates to the eligible set.
 *
 * Pure pass through passesAllMatchFilters — no side effects, no IO.
 */
export function filterCandidates(
	candidates: Phase1Candidate[],
	filters: PlaylistMatchFiltersV1,
	nowMs: number,
): Phase1Candidate[] {
	return candidates.filter((c) =>
		passesAllMatchFilters(filters, c.filterMeta, nowMs),
	);
}

const AUDIO_FEATURE_KEYS = [
	"energy",
	"valence",
	"danceability",
	"acousticness",
	"instrumentalness",
	"speechiness",
	"liveness",
	"tempo",
	"loudness",
] as const;

/**
 * Compute audio centroid from MatchingAudioFeatures objects.
 *
 * Direct mean across candidates — avoids coupling to the DB AudioFeature row
 * type (which carries id/created_at/updated_at columns). Semantically
 * equivalent to calculateAudioCentroid from the profiling calculations module.
 */
function computeAudioCentroidFromMatchingFeatures(
	candidates: Phase1Candidate[],
): Record<string, number> {
	const sums: Record<string, number> = {};
	const counts: Record<string, number> = {};

	for (const c of candidates) {
		const af = c.song.audioFeatures;
		if (!af) continue;
		for (const key of AUDIO_FEATURE_KEYS) {
			const v = af[key];
			if (typeof v === "number" && !Number.isNaN(v)) {
				sums[key] = (sums[key] ?? 0) + v;
				counts[key] = (counts[key] ?? 0) + 1;
			}
		}
	}

	const centroid: Record<string, number> = {};
	for (const key of AUDIO_FEATURE_KEYS) {
		const count = counts[key];
		if (count && count > 0) {
			centroid[key] = sums[key] / count;
		}
	}
	return centroid;
}

/**
 * Build a transient profile from genre pills + the eligible candidate set.
 *
 * Used on the free / no-intent path. No embedding is produced.
 *
 * Genre distribution: blendGenreDistribution blends declared pills (PILL_SHARE=0.5)
 * with observed song-genre counts from the eligible set.
 * Audio centroid: mean of audio features across all eligible candidates.
 */
export function buildProfileFromPills(
	eligibleCandidates: Phase1Candidate[],
	genrePills: string[],
): TransientProfile {
	// Accumulate observed genre counts from eligible songs for blending.
	const observedCounts: Record<string, number> = {};
	for (const c of eligibleCandidates) {
		for (const genre of c.song.genres ?? []) {
			observedCounts[genre] = (observedCounts[genre] ?? 0) + 1;
		}
	}

	const genreDistribution = blendGenreDistribution(observedCounts, genrePills);

	// Compute audio centroid directly from MatchingAudioFeatures rather than
	// going through the audio-feature DB row type (which would require faking
	// id/created_at/updated_at columns). Mean each feature across all candidates
	// that have it, matching the semantics of calculateAudioCentroid.
	const audioCentroid =
		computeAudioCentroidFromMatchingFeatures(eligibleCandidates);

	return {
		genreDistribution,
		audioCentroid,
		embedding: null,
		hasGenrePills: genrePills.length > 0,
	};
}

/**
 * Build a transient profile from a pre-computed intent embedding + pills.
 *
 * Used on the premium path when the account is intent-eligible. The caller
 * (server fn) is responsible for obtaining the embedding via the embeddings
 * service — this function only assembles the profile shape.
 */
export function buildProfileFromIntent(
	eligibleCandidates: Phase1Candidate[],
	genrePills: string[],
	intentEmbedding: number[],
): TransientProfile {
	const base = buildProfileFromPills(eligibleCandidates, genrePills);
	return { ...base, embedding: intentEmbedding };
}

/**
 * Score and rank all eligible candidates against the transient profile.
 *
 * When `profile.embedding` is null (free/no-intent path), the matching service
 * runs in noEmbeddingMode — vector scoring is skipped and the embedding weight
 * (0.5 default, 0.35 with genre pills) is redistributed proportionally onto
 * audio and genre. See MatchingConfig.noEmbeddingMode for the exact numbers.
 *
 * When `profile.embedding` is present (premium intent path), the service runs
 * in full-fusion mode. Candidates whose song IDs appear in `songEmbeddings`
 * get cosine-similarity scoring; those without embeddings fall back to
 * adaptive-weight redistribution via `hasEmbedding = false` in the scorer.
 * Passing an empty or absent map means all candidates use the no-embedding
 * fallback even on the intent path — the intent embedding in the profile only
 * influences results when song embeddings are also present.
 *
 * Candidates without audio features are still scored on genre alone (audio
 * weight further redistributed by computeAdaptiveWeights).
 *
 * Returns candidates sorted by score descending.
 */
export async function scoreCandidates(
	candidates: Phase1Candidate[],
	profile: TransientProfile,
	songEmbeddings?: Map<string, number[]>,
): Promise<Array<{ candidate: Phase1Candidate; score: number }>> {
	if (candidates.length === 0) return [];

	const useEmbedding = profile.embedding !== null;

	const matchingProfile: MatchingPlaylistProfile = {
		playlistId: DRAFT_PLAYLIST_ID,
		embedding: profile.embedding,
		audioCentroid: profile.audioCentroid,
		genreDistribution: profile.genreDistribution,
		hasGenrePills: profile.hasGenrePills,
	};

	const service = createMatchingService(null, null, {
		noEmbeddingMode: !useEmbedding,
		// Lower the threshold so the preview is generous — users can remove songs
		// they dislike. The ranking matters more than a hard cutoff here.
		minScoreThreshold: 0,
		// We score many songs against exactly one profile (the draft), so stats
		// are computed over the full candidate set rather than per-song-per-playlist.
		// With the full candidate set the z-score path is well-sampled.
		normalization: {
			enabled: true,
			method: "zscore",
			minSamples: 8,
			fallbackSimilarityBaseline: 0.5,
		},
	});

	const songs = candidates.map((c) => c.song);
	const result = await service.matchBatch(
		songs,
		[matchingProfile],
		songEmbeddings,
	);

	if (Result.isError(result)) {
		// Non-fatal: fall back to unscored order (no matches is a safe degradation)
		return candidates.map((c) => ({ candidate: c, score: 0 }));
	}

	// Build lookup from song id → score for the single draft profile
	const scoreMap = new Map<string, number>();
	for (const [songId, matches] of result.value.matches) {
		const match = (matches as MatchResult[]).find(
			(m) => m.playlistId === DRAFT_PLAYLIST_ID,
		);
		if (match) scoreMap.set(songId, match.score);
	}

	return candidates
		.map((c) => ({ candidate: c, score: scoreMap.get(c.song.id) ?? 0 }))
		.toSorted((a, b) => b.score - a.score);
}

/**
 * Map a Phase1Candidate to the SongVM view-model.
 */
function toSongVM(candidate: Phase1Candidate, score?: number): SongVM {
	const { song, display } = candidate;
	return {
		id: song.id,
		spotifyId: song.spotifyId,
		name: song.name,
		artist: song.artists[0] ?? "Unknown Artist",
		album: display.album,
		imageUrl: display.imageUrl,
		genres: song.genres ?? [],
		durationMs: display.durationMs,
		matchScore: score,
	};
}

export interface DraftResult {
	/** Top ≤ maxSongs candidates (pinned first, then ranked). */
	preview: SongVM[];
	/** Next ~12 ranked candidates not in preview or excluded. */
	suggestions: SongVM[];
	totalEligible: number;
	intentApplied: boolean;
}

const SUGGESTIONS_COUNT = 12;

/**
 * Assemble the full draft result from scored candidates.
 *
 * Pinned songs always appear first in preview regardless of score.
 * Excluded songs are dropped from both preview and suggestions.
 * After reserving pinned slots, remaining preview slots are filled by
 * the top-ranked non-pinned candidates. Suggestions follow immediately after.
 */
export function assembleDraft(
	scored: Array<{ candidate: Phase1Candidate; score: number }>,
	pinnedSongIds: string[],
	excludedSongIds: string[],
	maxSongs: number,
	intentApplied: boolean,
	allCandidates: Phase1Candidate[],
): DraftResult {
	const excludedSet = new Set(excludedSongIds);
	const pinnedSet = new Set(pinnedSongIds);

	const totalEligible = allCandidates.length;

	// Separate pinned from non-pinned, dropping excluded from both groups.
	const pinnedCandidates: Array<{ candidate: Phase1Candidate; score: number }> =
		[];
	const rankedCandidates: Array<{ candidate: Phase1Candidate; score: number }> =
		[];

	for (const entry of scored) {
		const id = entry.candidate.song.id;
		if (excludedSet.has(id)) continue;
		if (pinnedSet.has(id)) {
			pinnedCandidates.push(entry);
		} else {
			rankedCandidates.push(entry);
		}
	}

	// Preserve pinnedSongIds order (user-specified) rather than score order
	const pinnedOrder = new Map(pinnedSongIds.map((id, i) => [id, i]));
	pinnedCandidates.sort(
		(a, b) =>
			(pinnedOrder.get(a.candidate.song.id) ?? 0) -
			(pinnedOrder.get(b.candidate.song.id) ?? 0),
	);

	const remainingSlots = Math.max(0, maxSongs - pinnedCandidates.length);
	const previewRanked = rankedCandidates.slice(0, remainingSlots);
	const suggestionRanked = rankedCandidates.slice(
		remainingSlots,
		remainingSlots + SUGGESTIONS_COUNT,
	);

	const preview = [
		...pinnedCandidates.map((e) => toSongVM(e.candidate, e.score)),
		...previewRanked.map((e) => toSongVM(e.candidate, e.score)),
	];

	const suggestions = suggestionRanked.map((e) =>
		toSongVM(e.candidate, e.score),
	);

	return { preview, suggestions, totalEligible, intentApplied };
}
