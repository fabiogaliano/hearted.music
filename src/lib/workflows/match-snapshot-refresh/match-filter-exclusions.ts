/**
 * Converts hard-filter settings on target playlists into a per-(song,playlist)
 * exclusion set for use by the match refresh orchestrator (CMHF-12).
 *
 * Key invariants (Decisions §8):
 * - Exclusion key is `${songId}:${playlistId}` — composite so CMHF-12 can
 *   check membership without any cross-playlist join.
 * - AND across filter types; OR within language codes.
 * - Missing metadata fails any active filter (no "unknown" pass-through).
 * - Invalid stored filters skip that playlist only — not fatal.
 * - Metadata load failure degrades the whole call to empty exclusions.
 * - nowMs is computed once per call so likedAt "today" boundaries are consistent.
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { hasActiveMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import {
	passesLanguageFilter,
	passesLikedAtFilter,
	passesReleaseYearFilter,
	passesVocalGenderFilter,
} from "@/lib/domains/taste/match-filters/predicates";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type {
	MatchFiltersExclusionSummary,
	MatchFilterType,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { log } from "@/lib/observability/logger";
import { loadFilterMetadata } from "./filter-metadata-loader";

/**
 * Minimal playlist shape required by this helper.
 * The orchestrator's `Playlist` (Tables<"playlist">) satisfies this —
 * CMHF-12 can pass its existing array directly.
 */
export type PlaylistWithMatchFilters = {
	id: string;
	match_filters: Json;
};

export type LoadMatchFilterExclusionsInput = {
	accountId: string;
	playlists: PlaylistWithMatchFilters[];
	candidateSongIds: string[];
};

export type LoadMatchFilterExclusionsResult = {
	/**
	 * Set of `${songId}:${playlistId}` pairs where the song fails the
	 * playlist's hard filters. Empty when degraded or no active filters exist.
	 */
	exclusions: Set<string>;
	summary: MatchFiltersExclusionSummary;
};

/** Zero-count record for failedChecksByType — avoids sparse objects. */
function emptyFailedChecks(): Record<MatchFilterType, number> {
	return { languages: 0, releaseYear: 0, likedAt: 0, vocalGender: 0 };
}

// Invalid stored filters are detected during the parse pass, before any metadata
// load. A later degrade (metadata failure / eval throw) must still surface that
// accounting — it's independent of metadata — so callers pass the map through.
function degradedSummary(
	filterMetadata: boolean,
	invalidStoredFiltersByPlaylist: Record<string, number>,
): MatchFiltersExclusionSummary {
	return {
		activeFilterPlaylistCount: 0,
		candidatePairCount: 0,
		excludedPairCount: 0,
		failedChecksByType: emptyFailedChecks(),
		excludedPairsByPlaylist: {},
		invalidStoredFiltersByPlaylist,
		degraded: { baseExclusions: false, filterMetadata },
	};
}

/**
 * Evaluate individual filter types and record which type(s) failed.
 * Returns true when ALL active filters pass (identical semantics to
 * passesAllMatchFilters, but with per-type accounting).
 */
function evaluateWithAccounting(
	filters: PlaylistMatchFiltersV1,
	meta: SongFilterMetadata,
	nowMs: number,
	failedChecks: Record<MatchFilterType, number>,
): boolean {
	let excluded = false;

	if (filters.languages !== undefined) {
		if (!passesLanguageFilter(filters.languages.codes, meta)) {
			failedChecks.languages += 1;
			excluded = true;
		}
	}

	if (filters.releaseYear !== undefined) {
		if (!passesReleaseYearFilter(filters.releaseYear, meta.releaseYear)) {
			failedChecks.releaseYear += 1;
			excluded = true;
		}
	}

	if (filters.likedAt !== undefined) {
		if (!passesLikedAtFilter(filters.likedAt, meta.likedAt, nowMs)) {
			failedChecks.likedAt += 1;
			excluded = true;
		}
	}

	if (filters.vocalGender !== undefined) {
		if (!passesVocalGenderFilter(filters.vocalGender, meta.vocalGender)) {
			failedChecks.vocalGender += 1;
			excluded = true;
		}
	}

	return !excluded;
}

/**
 * Load and evaluate hard-filter exclusions for a refresh cycle.
 *
 * candidatePairCount definition: the sum over active-filter playlists of
 * the candidate song count — i.e., the exact number of (song, playlist)
 * pairs for which predicates were evaluated.
 *
 * excludedPairCount: each `${songId}:${playlistId}` composite key counted
 * exactly once regardless of how many individual filter types failed.
 */
export async function loadMatchFilterExclusions({
	accountId,
	playlists,
	candidateSongIds,
}: LoadMatchFilterExclusionsInput): Promise<LoadMatchFilterExclusionsResult> {
	// Parse playlists FIRST. A refresh where no target playlist has active hard
	// filters (the common default {version:1} case) must not touch the metadata
	// tables at all — so the active-filter set is determined before any DB read.
	// Invalid stored filters are logged/counted here too, independent of metadata.
	const activePlaylists: Array<{
		id: string;
		filters: PlaylistMatchFiltersV1;
	}> = [];
	const invalidStoredFiltersByPlaylist: Record<string, number> = {};

	for (const playlist of playlists) {
		const parseResult = parseStoredMatchFilters(playlist.match_filters);

		if (parseResult.wasNormalized) {
			log.warn("match:invalid-stored-filters", {
				accountId,
				playlistId: playlist.id,
				detail:
					"Known field had invalid data; normalized to default. Hard-filter exclusions skipped for this playlist.",
			});
			// Each playlist appears exactly once per call, so this is always a fresh entry.
			invalidStoredFiltersByPlaylist[playlist.id] = 1;
			// Skip this playlist's filter exclusions only.
			continue;
		}

		// Short-circuit: nothing to evaluate if no filters are active.
		if (!hasActiveMatchFilters(parseResult.value)) {
			continue;
		}

		activePlaylists.push({ id: playlist.id, filters: parseResult.value });
	}

	// No active filters anywhere → the empty exclusion set is the complete,
	// correct answer. Return before loading metadata so a default-config refresh
	// does zero song/liked-date DB reads and can't degrade on a metadata failure
	// that is irrelevant to it. (Not a degraded result — filterMetadata stays false.)
	if (activePlaylists.length === 0) {
		return {
			exclusions: new Set(),
			summary: {
				activeFilterPlaylistCount: 0,
				candidatePairCount: 0,
				excludedPairCount: 0,
				failedChecksByType: emptyFailedChecks(),
				excludedPairsByPlaylist: {},
				invalidStoredFiltersByPlaylist,
				degraded: { baseExclusions: false, filterMetadata: false },
			},
		};
	}

	const nowMs = Date.now();

	const metaResult = await loadFilterMetadata(accountId, candidateSongIds);

	if (Result.isError(metaResult)) {
		log.warn("match:filter-metadata-failed", {
			accountId,
			error: metaResult.error.message,
		});
		return {
			exclusions: new Set(),
			summary: degradedSummary(true, invalidStoredFiltersByPlaylist),
		};
	}

	const { songMeta, likedAtMs } = metaResult.value;

	const exclusions = new Set<string>();
	const failedChecksByType = emptyFailedChecks();
	const excludedPairsByPlaylist: Record<string, number> = {};
	let activeFilterPlaylistCount = 0;
	let candidatePairCount = 0;

	try {
		// Build the song metadata map once so inner loops are O(1) lookups.
		const songMetaCache = new Map<string, SongFilterMetadata>();
		for (const songId of candidateSongIds) {
			const sm = songMeta.get(songId);
			songMetaCache.set(songId, {
				language: sm?.language ?? null,
				languageSecondary: sm?.languageSecondary ?? null,
				releaseYear: sm?.releaseYear ?? null,
				vocalGender: sm?.vocalGender ?? null,
				likedAt: likedAtMs.get(songId) ?? null,
			});
		}

		for (const { id, filters } of activePlaylists) {
			activeFilterPlaylistCount += 1;
			candidatePairCount += candidateSongIds.length;

			for (const songId of candidateSongIds) {
				const meta = songMetaCache.get(songId);
				if (meta === undefined) {
					// Should not happen since we pre-built the cache for all candidateSongIds,
					// but guard defensively to avoid throwing inside the hot loop.
					continue;
				}

				const passes = evaluateWithAccounting(
					filters,
					meta,
					nowMs,
					failedChecksByType,
				);

				if (!passes) {
					exclusions.add(`${songId}:${id}`);
					excludedPairsByPlaylist[id] = (excludedPairsByPlaylist[id] ?? 0) + 1;
				}
			}
		}
	} catch (err) {
		// Decisions §8: hard-filter problems must degrade, not be fatal.
		// Any predicate or evaluation throw is caught here so the caller is
		// guaranteed a no-throw result.
		log.error("match:filter-eval-failed", {
			accountId,
			error: err instanceof Error ? err.message : String(err),
		});
		return {
			exclusions: new Set(),
			summary: degradedSummary(true, invalidStoredFiltersByPlaylist),
		};
	}

	const summary: MatchFiltersExclusionSummary = {
		activeFilterPlaylistCount,
		candidatePairCount,
		excludedPairCount: exclusions.size,
		failedChecksByType,
		excludedPairsByPlaylist,
		invalidStoredFiltersByPlaylist,
		degraded: { baseExclusions: false, filterMetadata: false },
	};

	return { exclusions, summary };
}
