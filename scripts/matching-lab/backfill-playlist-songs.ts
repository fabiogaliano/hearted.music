/**
 * Backfill playlist_song junction table from Spotify.
 *
 * Fetches each destination playlist's tracks via Pathfinder API,
 * cross-references with songs already in the DB, and inserts
 * playlist_song rows. This fixes the empty-profile cascade where
 * profiling produces intent-only embeddings with no audio/genre data.
 *
 * Usage:
 *   SPOTIFY_TOKEN="BQ..." bun run scripts/matching-lab/backfill-playlist-songs.ts
 *   SPOTIFY_TOKEN="BQ..." CLIENT_TOKEN="AAA..." bun run scripts/matching-lab/backfill-playlist-songs.ts
 */

import { createClient } from "@supabase/supabase-js";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const FETCH_PLAYLIST_CONTENTS_HASH =
	"9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f";

const supabase = createClient(
	"http://127.0.0.1:54321",
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

const token = process.env.SPOTIFY_TOKEN;
if (!token) {
	console.error("❌ Set SPOTIFY_TOKEN env var (Bearer token from Spotify web player)");
	process.exit(1);
}
const clientToken = process.env.CLIENT_TOKEN;

// Pathfinder requires browser-like headers to avoid 403s
const PATHFINDER_HEADERS: Record<string, string> = {
	accept: "application/json",
	"accept-language": "en-GB",
	"app-platform": "WebPlayer",
	authorization: `Bearer ${token}`,
	"content-type": "application/json;charset=UTF-8",
	origin: "https://open.spotify.com",
	referer: "https://open.spotify.com/",
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
	...(clientToken ? { "client-token": clientToken } : {}),
};

type PlaylistContentItem = {
	addedAt?: { isoString: string };
	itemV2?: {
		data?: {
			__typename: string;
			uri: string;
			name: string;
		};
	};
};

type FetchPlaylistContentsResponse = {
	data: {
		playlistV2: {
			content: {
				items: PlaylistContentItem[];
				totalCount: number;
			};
		};
	};
};

function extractId(uri: string): string {
	return uri.split(":").pop() as string;
}

async function fetchPlaylistTracks(
	playlistSpotifyId: string,
): Promise<{ spotifyId: string; addedAt: string }[]> {
	const playlistUri = `spotify:playlist:${playlistSpotifyId}`;
	const allTracks: { spotifyId: string; addedAt: string }[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	let retries = 0;
	const MAX_RETRIES = 5;

	while (offset < total) {
		const res = await fetch(PATHFINDER_URL, {
			method: "POST",
			headers: PATHFINDER_HEADERS,
			body: JSON.stringify({
				variables: { uri: playlistUri, offset, limit },
				operationName: "fetchPlaylistContents",
				extensions: {
					persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST_CONTENTS_HASH },
				},
			}),
		});

		if (res.status === 429) {
			retries++;
			if (retries > MAX_RETRIES) {
				throw new Error(`Rate limited ${MAX_RETRIES} times in a row, aborting`);
			}
			const retryAfter = Number(res.headers.get("Retry-After")) || 5;
			console.log(`  ⏳ Rate limited (${retries}/${MAX_RETRIES}), waiting ${retryAfter}s...`);
			await new Promise((r) => setTimeout(r, retryAfter * 1000));
			continue;
		}
		retries = 0;

		if (!res.ok) {
			throw new Error(`Pathfinder error: ${res.status} ${await res.text()}`);
		}

		const json = (await res.json()) as FetchPlaylistContentsResponse;
		const content = json.data?.playlistV2?.content;
		const items = content?.items ?? [];
		total = content?.totalCount ?? items.length;

		for (const item of items) {
			const track = item.itemV2?.data;
			if (!track || track.__typename !== "Track") continue;
			allTracks.push({
				spotifyId: extractId(track.uri),
				addedAt: item.addedAt?.isoString ?? new Date().toISOString(),
			});
		}

		offset += limit;

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allTracks;
}

async function main() {
	console.log("\n🔗 Backfilling playlist_song from Spotify...\n");

	const { data: playlists, error } = await supabase
		.from("playlist")
		.select("id, spotify_id, name, song_count")
		.eq("is_destination", true)
		.order("name");

	if (error || !playlists) {
		console.error("❌ Failed to load playlists:", error);
		process.exit(1);
	}

	console.log(`  Found ${playlists.length} destination playlists\n`);

	const { data: songs, error: songsError } = await supabase
		.from("song")
		.select("id, spotify_id");

	if (songsError || !songs) {
		console.error("❌ Failed to load songs:", songsError);
		process.exit(1);
	}

	const songMap = new Map(songs.map((s) => [s.spotify_id, s.id]));
	console.log(`  Loaded ${songMap.size} songs for cross-reference\n`);

	let totalInserted = 0;
	let totalSkipped = 0;

	for (const playlist of playlists) {
		console.log(`  ┌─ ${playlist.name} (${playlist.spotify_id})`);

		const spotifyTracks = await fetchPlaylistTracks(playlist.spotify_id);
		console.log(`  │  Spotify tracks: ${spotifyTracks.length}`);

		const matchedRows: { song_id: string; position: number; added_at: string }[] = [];
		let unmatched = 0;

		for (let i = 0; i < spotifyTracks.length; i++) {
			const track = spotifyTracks[i];
			const songId = songMap.get(track.spotifyId);
			if (songId) {
				matchedRows.push({
					song_id: songId,
					position: i,
					added_at: track.addedAt,
				});
			} else {
				unmatched++;
			}
		}

		console.log(`  │  Matched in DB: ${matchedRows.length}, Not in DB: ${unmatched}`);

		if (matchedRows.length > 0) {
			let batchInserted = 0;
			for (let i = 0; i < matchedRows.length; i += 100) {
				const batch = matchedRows.slice(i, i + 100);
				const { error: upsertError } = await supabase
					.from("playlist_song")
					.upsert(
						batch.map((row) => ({
							playlist_id: playlist.id,
							song_id: row.song_id,
							position: row.position,
							added_at: row.added_at,
						})),
						{ onConflict: "playlist_id,song_id" },
					);

				if (upsertError) {
					console.error(`  │  ❌ Upsert failed:`, upsertError.message);
				} else {
					batchInserted += batch.length;
				}
			}
			totalInserted += batchInserted;
		}

		totalSkipped += unmatched;

		await supabase
			.from("playlist")
			.update({ song_count: spotifyTracks.length })
			.eq("id", playlist.id);

		console.log(`  └─ ✅ ${matchedRows.length} rows upserted\n`);
	}

	const { count } = await supabase
		.from("playlist_song")
		.select("*", { count: "exact", head: true });

	console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
	console.log(`  Total inserted:   ${totalInserted}`);
	console.log(`  Not in DB:        ${totalSkipped}`);
	console.log(`  playlist_song rows: ${count}`);
	console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
	console.log("Next step: re-profile playlists →");
	console.log("  bun run scripts/matching-lab/reprofile-playlists.ts\n");
}

main().catch(console.error);
