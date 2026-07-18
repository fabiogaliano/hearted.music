/**
 * Balanced allocation of artist-derived pins for the playlist studio.
 *
 * Given the enabled artists' resolved song ids (recency-ordered: the artist
 * resolution query returns most-recently-liked first) and a slot budget, pick
 * a fair, interleaved pin list: even split across artists, unused quota
 * redistributed to artists that still have songs, round-robin order so the
 * top of the tracklist reads as breadth rather than one artist's block.
 *
 * A single round-robin walk produces exactly that result: each pass takes one
 * song per artist, so counts never differ by more than one among artists with
 * songs left (the even split), artists that run out simply stop contributing
 * (the redistribution), and the emission order is A1 B1 C1 A2 B2 … (the
 * interleave). Songs credited to several selected artists are deduplicated at
 * take time — the slot stays with the artist, who advances to their next
 * unclaimed song.
 *
 * Pure and client-safe: no IO, deterministic for a given input.
 */

/** One enabled artist's resolved, recency-ordered liked-song ids. */
export interface ArtistSongPool {
	name: string;
	songIds: string[];
}

export function allocateArtistPins(
	pools: ArtistSongPool[],
	slots: number,
): string[] {
	if (slots <= 0 || pools.length === 0) return [];

	const taken = new Set<string>();
	const cursors = new Array<number>(pools.length).fill(0);
	const picked: string[] = [];

	// Each outer iteration is one round-robin pass; stop when the budget is
	// spent or a full pass yields nothing (every pool exhausted).
	let progressed = true;
	while (picked.length < slots && progressed) {
		progressed = false;
		for (let i = 0; i < pools.length && picked.length < slots; i++) {
			const songIds = pools[i]?.songIds ?? [];
			let cursor = cursors[i] ?? 0;
			while (cursor < songIds.length) {
				const id = songIds[cursor];
				cursor++;
				if (id !== undefined && !taken.has(id)) {
					taken.add(id);
					picked.push(id);
					progressed = true;
					break;
				}
			}
			cursors[i] = cursor;
		}
	}

	return picked;
}
