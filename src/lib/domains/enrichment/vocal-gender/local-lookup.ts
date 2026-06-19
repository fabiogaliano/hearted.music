/**
 * Local MusicBrainz gender lookup — the offline first hop of vocal-gender
 * resolution. Reads the committed SQLite distilled from a MusicBrainz full
 * export (see scripts/maintenance/build-vocal-gender-db.ts), so resolving a
 * known artist costs a microsecond point lookup with zero network and no
 * MusicBrainz API rate limit.
 *
 * Worker-only: bun:sqlite has no Cloudflare-edge equivalent, so it's loaded via
 * dynamic import and this module must never reach the app bundle — it's imported
 * only from the worker's enrichment path. The Database handle + prepared
 * statement are cached for the life of the long-running worker process.
 */

import { fileURLToPath } from "node:url";

export type LocalGender = "female" | "male" | "other";

const DB_PATH = fileURLToPath(
	new URL("./data/musicbrainz-gender.sqlite", import.meta.url),
);

interface LookupHandle {
	get(spotifyId: string): { gender: LocalGender } | undefined;
}

let handlePromise: Promise<LookupHandle> | null = null;

async function getHandle(): Promise<LookupHandle> {
	if (!handlePromise) {
		handlePromise = (async () => {
			const { Database } = await import("bun:sqlite");
			const db = new Database(DB_PATH, { readonly: true });
			const stmt = db.query<{ gender: LocalGender }, [string]>(
				"select gender from artist_gender where spotify_id = ?",
			);
			return { get: (id: string) => stmt.get(id) ?? undefined };
		})();
	}
	return handlePromise;
}

/**
 * Resolves Spotify artist ids to gender from the local dump. Misses (artist
 * absent, or only present with "not applicable") are simply omitted from the
 * map — callers fall through to the Wikidata fallback for those.
 */
export async function lookupLocalGenders(
	spotifyIds: string[],
): Promise<Map<string, LocalGender>> {
	const out = new Map<string, LocalGender>();
	if (spotifyIds.length === 0) return out;

	const handle = await getHandle();
	for (const id of new Set(spotifyIds)) {
		const row = handle.get(id);
		if (row) out.set(id, row.gender);
	}
	return out;
}
