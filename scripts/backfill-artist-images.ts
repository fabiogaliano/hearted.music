/**
 * Backfill artist images using Spotify's Pathfinder API.
 *
 * Usage: SPOTIFY_TOKEN='Bearer ...' bun scripts/backfill-artist-images.ts
 *
 * Two phases:
 * 1. fetchLibraryTracks (Pathfinder) to get artist IDs → backfill song.artist_ids
 * 2. queryArtistOverview (Pathfinder) to get artist images → upsert to artist table
 */

import { createAdminSupabaseClient } from "@/lib/data/client";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const HASHES = {
	fetchLibraryTracks:
		"087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
	queryArtistOverview:
		"dd14c6043d8127b56c5acbe534f6b3c58714f0c26bc6ad41776079ed52833a8f",
};

const TOKEN = process.env.SPOTIFY_TOKEN;
if (!TOKEN) {
	console.error(
		"Set SPOTIFY_TOKEN env var (Bearer token from Spotify web player)",
	);
	process.exit(1);
}

const authHeader = TOKEN.startsWith("Bearer ") ? TOKEN : `Bearer ${TOKEN}`;

const HEADERS: Record<string, string> = {
	accept: "application/json",
	"accept-language": "en-GB",
	"app-platform": "WebPlayer",
	authorization: authHeader,
	"content-type": "application/json;charset=UTF-8",
	origin: "https://open.spotify.com",
	referer: "https://open.spotify.com/",
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

function extractId(uri: string): string {
	return uri.split(":").pop()!;
}

function checkTokenExpired(status: number) {
	if (status === 401) {
		console.error("\nToken expired — get a fresh one from Spotify web player");
		process.exit(1);
	}
}

async function pathfinderQuery(
	operationName: string,
	variables: Record<string, unknown>,
) {
	const body = {
		operationName,
		variables,
		extensions: {
			persistedQuery: {
				version: 1,
				sha256Hash: HASHES[operationName as keyof typeof HASHES],
			},
		},
	};

	const res = await fetch(PATHFINDER_URL, {
		method: "POST",
		headers: HEADERS,
		body: JSON.stringify(body),
	});

	checkTokenExpired(res.status);
	if (!res.ok) throw new Error(`Pathfinder ${res.status}: ${operationName}`);
	return res.json();
}

// --- Phase 1: Fetch liked songs from Pathfinder to get artist IDs ---

interface LibraryArtist {
	id: string;
	name: string;
}

interface LibraryTrack {
	spotifyId: string;
	artists: LibraryArtist[];
}

async function fetchAllLikedTracks(): Promise<LibraryTrack[]> {
	const all: LibraryTrack[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await pathfinderQuery("fetchLibraryTracks", { offset, limit });
		const tracks = data.data?.me?.library?.tracks;
		const items = tracks?.items ?? [];
		total = tracks?.totalCount ?? items.length;

		for (const item of items) {
			if (!item.track?._uri?.startsWith("spotify:track:")) continue;
			const track = item.track.data;
			all.push({
				spotifyId: extractId(item.track._uri),
				artists: (track.artists?.items ?? []).map(
					(a: { uri: string; profile?: { name?: string } }) => ({
						id: extractId(a.uri),
						name: a.profile?.name ?? "",
					}),
				),
			});
		}

		offset += limit;
		console.log(`  Fetched ${all.length}/${total} liked tracks`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return all;
}

// --- Phase 2: Fetch artist images via Pathfinder ---

interface AvatarSource {
	url: string;
	width: number;
	height: number;
}

async function fetchArtistImage(
	artistId: string,
): Promise<{ name: string; imageUrl: string | null } | null> {
	try {
		const json = await pathfinderQuery("queryArtistOverview", {
			uri: `spotify:artist:${artistId}`,
			locale: "en",
		});

		const artist = json?.data?.artistUnion;
		if (!artist || artist.__typename !== "Artist") return null;

		const sources: AvatarSource[] =
			artist.visuals?.avatarImage?.sources ?? [];
		const best = sources.reduce<AvatarSource | null>(
			(a, b) => (!a || b.width > a.width ? b : a),
			null,
		);

		return {
			name: artist.profile?.name ?? artistId,
			imageUrl: best?.url ?? null,
		};
	} catch (e) {
		console.warn(`  Failed for ${artistId}: ${(e as Error).message}`);
		return null;
	}
}

// --- Main ---

const supabase = createAdminSupabaseClient();

console.log("--- Phase 1: Fetch liked songs from Pathfinder ---");
const likedTracks = await fetchAllLikedTracks();
console.log(`Got ${likedTracks.length} liked tracks with artist data\n`);

// Build spotify_id → artist data mapping
const trackArtistMap = new Map(
	likedTracks.map((t) => [t.spotifyId, t.artists]),
);

// Get all songs from DB
const { data: songs, error } = await supabase
	.from("song")
	.select("id, spotify_id, artist_ids");

if (error || !songs) {
	console.error("Failed to fetch songs:", error);
	process.exit(1);
}

// Update songs missing artist_ids
const songsNeedingIds = songs.filter(
	(s) => !s.artist_ids || s.artist_ids.length === 0,
);
let updatedSongs = 0;

if (songsNeedingIds.length > 0) {
	console.log(`Updating artist_ids for ${songsNeedingIds.length} songs...`);

	for (const song of songsNeedingIds) {
		const artists = trackArtistMap.get(song.spotify_id);
		if (!artists || artists.length === 0) continue;

		const { error: updateError } = await supabase
			.from("song")
			.update({
				artist_ids: artists.map((a) => a.id),
				artists: artists.map((a) => a.name),
			})
			.eq("id", song.id);

		if (!updateError) {
			updatedSongs++;
			song.artist_ids = artists.map((a) => a.id);
		}
	}

	console.log(`  Updated ${updatedSongs}/${songsNeedingIds.length} songs\n`);
}

// Collect all unique artist IDs (from DB + freshly fetched)
const artistMap = new Map<string, string>();
for (const song of songs) {
	const ids: string[] = song.artist_ids ?? [];
	for (const id of ids) {
		if (id && !artistMap.has(id)) {
			const fromTrack = trackArtistMap
				.get(song.spotify_id)
				?.find((a) => a.id === id);
			artistMap.set(id, fromTrack?.name ?? "Unknown");
		}
	}
}
// Also include artists from Pathfinder that may not be in DB songs
for (const track of likedTracks) {
	for (const a of track.artists) {
		if (!artistMap.has(a.id)) {
			artistMap.set(a.id, a.name);
		}
	}
}

// Check which already exist
const artistIds = [...artistMap.keys()];
const { data: existing } = await supabase
	.from("artist")
	.select("spotify_id")
	.in("spotify_id", artistIds.length > 0 ? artistIds : ["__none__"]);

const existingIds = new Set((existing ?? []).map((a) => a.spotify_id));
const toFetch = [...artistMap.entries()].filter(
	([id]) => !existingIds.has(id),
);

console.log("--- Phase 2: Fetch artist images ---");
console.log(
	`${artistMap.size} unique artists, ${existingIds.size} already in DB, ${toFetch.length} to fetch`,
);

if (toFetch.length === 0) {
	console.log("Nothing to backfill!");
	process.exit(0);
}

let success = 0;
let failed = 0;

for (let i = 0; i < toFetch.length; i++) {
	const [artistId, fallbackName] = toFetch[i];
	const result = await fetchArtistImage(artistId);

	const name = result?.name ?? fallbackName;
	const imageUrl = result?.imageUrl ?? null;

	const { error: upsertError } = await supabase.from("artist").upsert(
		{ spotify_id: artistId, name, image_url: imageUrl },
		{ onConflict: "spotify_id" },
	);

	if (upsertError) {
		console.warn(`  DB error for ${artistId}: ${upsertError.message}`);
		failed++;
	} else {
		success++;
	}

	if ((i + 1) % 10 === 0 || i === toFetch.length - 1) {
		console.log(
			`  [${i + 1}/${toFetch.length}] ${name} — ${imageUrl ? "has image" : "no image"}`,
		);
	}

	if (i < toFetch.length - 1) {
		await new Promise((r) => setTimeout(r, 100));
	}
}

console.log(
	`\nDone! ${success} artists added, ${failed} failed. ${updatedSongs} songs updated with artist_ids.`,
);
