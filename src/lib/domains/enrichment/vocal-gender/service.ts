/**
 * Vocal-gender resolution — the Phase-1 (lightweight) enrichment step that fills
 * a new artist's gender so song.vocal_gender is ready before analysis/matching.
 *
 * Resolution order, per the design:
 *   1. local MusicBrainz dump  (offline, instant, no API)
 *   2. Wikidata                (batched SPARQL fallback — solo P21 + band members)
 * The MusicBrainz HTTP API is no longer called anywhere in this path.
 *
 * Best-effort by contract: it catches its own failures and returns stats instead
 * of throwing, so a gender hiccup never fails the enrichment chunk. vocal_gender
 * is a nice-to-have signal, not a gate.
 */

import { Result } from "better-result";
import {
	applyGenderResolution,
	type GenderResolution,
	getUnresolvedGenderArtists,
} from "@/lib/domains/library/artists/queries";
import { refreshVocalGenderForSongs } from "@/lib/domains/library/songs/queries";
import { log } from "@/lib/observability/logger";
import { lookupLocalGenders } from "./local-lookup";
import { resolveWikidataGenders } from "./wikidata-fallback";

export interface VocalGenderSong {
	id: string;
	artist_ids: string[];
}

export interface VocalGenderStats {
	unresolvedArtists: number;
	resolvedLocal: number;
	resolvedWikidata: number;
	songsRefreshed: number;
}

const EMPTY: VocalGenderStats = {
	unresolvedArtists: 0,
	resolvedLocal: 0,
	resolvedWikidata: 0,
	songsRefreshed: 0,
};

/**
 * Resolves gender for the not-yet-attempted artists of the given songs, then
 * recomputes vocal_gender for those songs. Safe to call on every Phase-1 batch:
 * already-resolved artists are filtered out up front, so steady state is a no-op.
 */
export async function resolveVocalGenderForSongs(
	songs: VocalGenderSong[],
): Promise<VocalGenderStats> {
	try {
		const artistIds = [...new Set(songs.flatMap((s) => s.artist_ids))];
		if (artistIds.length === 0) return EMPTY;

		const unresolvedResult = await getUnresolvedGenderArtists(artistIds);
		if (Result.isError(unresolvedResult)) {
			log.warn("vocal-gender:unresolved-query-failed", {
				error: unresolvedResult.error.message,
			});
			return EMPTY;
		}
		const unresolved = unresolvedResult.value;
		if (unresolved.length === 0) return EMPTY;

		// Hop 1: local MusicBrainz dump.
		const local = await lookupLocalGenders(unresolved);
		const payload: GenderResolution[] = [];
		for (const [spotify_id, gender] of local) {
			payload.push({
				spotify_id,
				gender,
				band_gender: null,
				wikidata_id: null,
				wd_checked: false,
			});
		}

		// Hop 2: Wikidata for whatever the dump didn't cover (mostly bands).
		const misses = unresolved.filter((id) => !local.has(id));
		let resolvedWikidata = 0;
		if (misses.length > 0) {
			const wikidata = await resolveWikidataGenders(misses);
			for (const r of wikidata) {
				if (r.gender || r.band_gender) resolvedWikidata++;
				payload.push({
					spotify_id: r.spotify_id,
					gender: r.gender,
					band_gender: r.band_gender,
					wikidata_id: r.wikidata_id,
					wd_checked: true,
				});
			}
		}

		if (payload.length > 0) {
			const applied = await applyGenderResolution(payload);
			if (Result.isError(applied)) {
				log.warn("vocal-gender:apply-failed", { error: applied.error.message });
				return EMPTY;
			}
		}

		// Recompute vocal_gender only for this batch's songs.
		const refreshed = await refreshVocalGenderForSongs(songs.map((s) => s.id));
		const songsRefreshed = Result.isOk(refreshed) ? refreshed.value : 0;
		if (Result.isError(refreshed)) {
			log.warn("vocal-gender:refresh-failed", {
				error: refreshed.error.message,
			});
		}

		const stats: VocalGenderStats = {
			unresolvedArtists: unresolved.length,
			resolvedLocal: local.size,
			resolvedWikidata,
			songsRefreshed,
		};
		log.info("vocal-gender:resolved", { ...stats });
		return stats;
	} catch (err) {
		log.warn("vocal-gender:unexpected-error", {
			error: err instanceof Error ? err.message : String(err),
		});
		return EMPTY;
	}
}
