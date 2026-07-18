/**
 * Pure domain logic for the playlist creation preview engine.
 *
 * All functions here are stateless and side-effect-free (no DB writes, no
 * persisted profiles, no snapshot rows). They take in-memory data and return
 * ranked SongVM lists. Server orchestration (DB reads, auth context) lives in
 * workflows/playlist-studio/preview.ts (and its thin server-fn adapter,
 * server/playlist-draft.functions.ts); this module is the testable core.
 *
 * The pipeline reads as a sentence:
 *   selectEligibleCandidates → buildDraftProfile → rankCandidates →
 *   composePlaylistPreview
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
import { SUGGESTIONS_COUNT } from "./constants";
import type { SongVM } from "./types";

/**
 * The never-persisted profile of the draft being edited in the studio.
 * Mirrors MatchingPlaylistProfile but without a real playlist ID.
 */
interface DraftProfile {
	genreDistribution: GenreDistribution;
	audioCentroid: Record<string, number>;
	/** Query embedding — present only on the intent/premium path. */
	embedding: number[] | null;
	hasGenrePills: boolean;
}

// Synthetic playlist ID for the scoring pass. The draft engine scores every
// candidate against a single draft profile, so the ID is only needed to
// satisfy the MatchingPlaylistProfile interface — it is never stored or returned.
const DRAFT_PLAYLIST_ID = "__draft__";

/**
 * Wire bound on the preview input's pinnedSongIds: the client clamps its
 * effective union to this before sending, and the server schema rejects
 * anything longer. The engine itself clamps kept pins to maxSongs (≤ this)
 * and reports overflow via droppedPinnedSongIds, so ids past this bound could
 * only ever have shortened that report — never the kept tracklist.
 */
export const MAX_PINNED_SONG_IDS = 50;

/**
 * Apply hard match-filters to select the eligible candidate set.
 *
 * Pure pass through passesAllMatchFilters — no side effects, no IO.
 */
export function selectEligibleCandidates(
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
 * Build the draft's profile from genre pills + the eligible candidate set,
 * optionally carrying a pre-computed intent embedding (premium path).
 *
 * Genre distribution: blendGenreDistribution blends declared pills (PILL_SHARE=0.5)
 * with observed song-genre counts from the eligible set.
 * Audio centroid: mean of audio features across all eligible candidates.
 *
 * When `intentEmbedding` is provided, it is set as the profile's query
 * embedding and semantic ranking becomes active in rankCandidates. The caller
 * (server workflow) is responsible for obtaining the embedding via the
 * embeddings service — this function only assembles the profile shape.
 */
export function buildDraftProfile(
	eligibleCandidates: Phase1Candidate[],
	genrePills: string[],
	intentEmbedding?: number[],
): DraftProfile {
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
		embedding: intentEmbedding ?? null,
		hasGenrePills: genrePills.length > 0,
	};
}

/** One candidate with its match score, in ranking order. */
export interface RankedCandidate {
	candidate: Phase1Candidate;
	score: number;
}

/**
 * Rank all eligible candidates against the draft profile: scores every
 * candidate via the matching service, returns them sorted by score descending.
 * The ordering is the contract — composePlaylistPreview slices top-N from it.
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
 */
export async function rankCandidates(
	candidates: Phase1Candidate[],
	profile: DraftProfile,
	songEmbeddings?: Map<string, number[]>,
): Promise<RankedCandidate[]> {
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
		// Non-fatal: fall back to unscored order (no matches is a safe
		// degradation), but say so — the "ranking" is insertion order from here.
		console.error(
			"[draft-engine] matchBatch failed, ranking degraded to unscored order",
			result.error,
		);
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

export interface PlaylistDraftPreview {
	/**
	 * The songs currently in the draft — pins first (user order), then ranked
	 * fill. Never exceeds maxSongs: this is what "Create" will persist.
	 */
	tracklist: SongVM[];
	/** Next ~12 ranked candidates not in the tracklist or excluded. */
	suggestions: SongVM[];
	totalEligible: number;
	intentApplied: boolean;
	/**
	 * Pinned ids that could not be honored: excluded, filtered out by match
	 * filters, no longer liked, or cut by the maxSongs clamp. Lets the UI tell
	 * the truth instead of silently showing fewer songs than the user pinned.
	 */
	droppedPinnedSongIds: string[];
}

export interface ComposePlaylistPreviewInput {
	/** Output of rankCandidates — order is load-bearing. */
	ranking: RankedCandidate[];
	/** Song IDs the user explicitly added — appear first, in this order. */
	pinnedSongIds: string[];
	/** Song IDs the user explicitly removed — never appear in results. */
	excludedSongIds: string[];
	maxSongs: number;
	intentApplied: boolean;
	totalEligible: number;
	/**
	 * Pages the suggestions window deeper into the ranked (non-pinned,
	 * non-excluded) candidates without touching config or scoring — this is
	 * what "Refresh suggestions" uses to rotate in a genuinely new batch. It
	 * does not shift the tracklist window: the tracklist always starts at the
	 * top of the ranking so a refresh never changes which songs are already
	 * picked.
	 */
	suggestionsOffset?: number;
}

/**
 * Compose the studio's preview of the draft from the ranking + the user's
 * overrides (pins, exclusions, maxSongs).
 *
 * Pinned songs always lead the tracklist in user order regardless of score;
 * remaining slots are filled by the top-ranked non-pinned candidates, and the
 * whole tracklist is clamped to maxSongs. Pins that can't be honored —
 * excluded, absent from the ranking (filtered out / unliked), or cut by the
 * clamp — are reported in droppedPinnedSongIds rather than silently vanishing.
 * Clamped pins do not re-enter the suggestions pool: suggestions mean "the
 * engine thinks you'd like these", and a demoted user choice is not that.
 */
export function composePlaylistPreview(
	input: ComposePlaylistPreviewInput,
): PlaylistDraftPreview {
	const {
		ranking,
		pinnedSongIds,
		excludedSongIds,
		maxSongs,
		intentApplied,
		totalEligible,
		suggestionsOffset = 0,
	} = input;

	const excluded = new Set(excludedSongIds);
	const pinned = new Set(pinnedSongIds);
	const byId = new Map(ranking.map((e) => [e.candidate.song.id, e]));

	// Walk pinnedSongIds directly: user order is preserved by construction,
	// and every id that can't be honored is collected instead of vanishing.
	const droppedPinnedSongIds: string[] = [];
	const pinnedEntries: RankedCandidate[] = [];
	for (const id of pinnedSongIds) {
		const entry = byId.get(id);
		if (!entry || excluded.has(id)) {
			droppedPinnedSongIds.push(id);
			continue;
		}
		pinnedEntries.push(entry);
	}

	// The maxSongs clamp: pins beyond the cap are dropped and reported.
	const keptPins = pinnedEntries.slice(0, maxSongs);
	for (const entry of pinnedEntries.slice(maxSongs)) {
		droppedPinnedSongIds.push(entry.candidate.song.id);
	}

	const ranked = ranking.filter((e) => {
		const id = e.candidate.song.id;
		return !pinned.has(id) && !excluded.has(id);
	});

	const rankedSlots = maxSongs - keptPins.length;
	const tracklistRanked = ranked.slice(0, rankedSlots);

	// Clamp so a stale/out-of-range offset (e.g. after an exclusion shrinks the
	// ranked pool, or the user keeps clicking refresh past the end) degrades to
	// the last available window rather than returning nothing.
	const suggestionsPoolSize = Math.max(0, ranked.length - rankedSlots);
	const maxOffset = Math.max(0, suggestionsPoolSize - SUGGESTIONS_COUNT);
	const safeOffset = Math.max(0, Math.min(suggestionsOffset, maxOffset));
	const suggestionsStart = rankedSlots + safeOffset;

	return {
		tracklist: [
			...keptPins.map((e) => toSongVM(e.candidate, e.score)),
			...tracklistRanked.map((e) => toSongVM(e.candidate, e.score)),
		],
		suggestions: ranked
			.slice(suggestionsStart, suggestionsStart + SUGGESTIONS_COUNT)
			.map((e) => toSongVM(e.candidate, e.score)),
		totalEligible,
		intentApplied,
		droppedPinnedSongIds,
	};
}
