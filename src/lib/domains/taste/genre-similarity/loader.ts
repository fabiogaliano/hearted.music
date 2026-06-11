/**
 * Genre similarity loader — thin read-only interface over the pre-built artifact.
 *
 * The artifact (`table.json`) is compiled from the hand-curated genresgraph repo
 * at `/Users/f/Core/dev/clones/genresgraph-mit` and synced here via
 * `bun run compile && bun scripts/sync.ts --confirm` in that repo.
 *
 * The table is DIRECTED: `table[playlistGenre][songGenre]` reflects the
 * playlist's perspective of the song's genre. Both directions are explicitly
 * emitted for every pair, so hierarchy edges are asymmetric (e.g. rock→"hard
 * rock" = 0.6, "hard rock"→rock = 0.45). The `?? table[cb]?.[ca]` fallback
 * is a safety net for any one-sided entry, NOT a symmetry guarantee.
 *
 * Raw stored values (in [0.3, 0.6]) are returned; banding (cap/floor) is
 * applied by the scorer in service.ts.
 *
 * 4 isolated genres (christmas, crossover, mashup, vocal) have no edges in the
 * graph and are intentionally absent as keys; all lookups for them return 0.
 */

import { canonicalizeGenre } from "@/lib/integrations/lastfm/whitelist";
import rawTable from "./table.json";
import type { SimilarityTable } from "./types";

// _meta is structural metadata, not a genre entry — cast away.
const table = rawTable as unknown as SimilarityTable;

// Read the artifact version for cache-invalidation wiring downstream.
const rawMeta = (rawTable as Record<string, unknown>)._meta as
	| Record<string, unknown>
	| undefined;
export const GENRE_TABLE_VERSION: string =
	typeof rawMeta?.version === "string" ? rawMeta.version : "0";

/**
 * Directed similarity from genre `a` (playlist perspective) to genre `b`
 * (song perspective), in [0, 1].
 *
 * Returns 1 for self-comparison (after canonicalization), the stored directed
 * value for `a→b` if present, the reverse `b→a` as a safety-net fallback, or
 * 0 if no entry exists.
 */
export function genreSimilarity(a: string, b: string): number {
	const ca = canonicalizeGenre(a.toLowerCase());
	const cb = canonicalizeGenre(b.toLowerCase());
	if (ca === cb) return 1;
	// Primary: playlist genre's outgoing edge to song genre.
	// Fallback: reverse direction as safety net for one-sided entries.
	return table[ca]?.[cb] ?? table[cb]?.[ca] ?? 0;
}

/**
 * All stored neighbors for a genre, keyed by canonical neighbor name → sim.
 * Returns an empty object for unmatched or zero-neighbor genres.
 */
export function genreNeighbors(g: string): Record<string, number> {
	const cg = canonicalizeGenre(g.toLowerCase());
	return table[cg] ?? {};
}
