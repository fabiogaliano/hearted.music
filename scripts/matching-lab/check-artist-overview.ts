/**
 * Query Spotify Pathfinder's queryArtistOverview for one artist and print
 * whatever image/bio data it returns. Diagnostic only — no DB writes.
 *
 * Usage:
 *   SPOTIFY_TOKEN="BQ..." bun run scripts/matching-lab/check-artist-overview.ts [spotifyArtistId]
 *   SPOTIFY_TOKEN="BQ..." CLIENT_TOKEN="AAA..." bun run scripts/matching-lab/check-artist-overview.ts
 *
 * Defaults to Tiffany Day (5D5Qbe1lf3aMnLsPSzXItu) if no id is given.
 */

export {};

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const QUERY_ARTIST_OVERVIEW_HASH =
	"ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a";

const token = process.env.SPOTIFY_TOKEN;
if (!token) {
	console.error("❌ Set SPOTIFY_TOKEN env var (Bearer token from Spotify web player)");
	process.exit(1);
}
const clientToken = process.env.CLIENT_TOKEN;

// Pathfinder requires browser-like headers to avoid 403s (see backfill-playlist-songs.ts)
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

const artistId = process.argv[2] ?? "5D5Qbe1lf3aMnLsPSzXItu"; // Tiffany Day
const artistUri = `spotify:artist:${artistId}`;

const res = await fetch(PATHFINDER_URL, {
	method: "POST",
	headers: PATHFINDER_HEADERS,
	body: JSON.stringify({
		variables: { uri: artistUri, locale: "", preReleaseV2: false },
		operationName: "queryArtistOverview",
		extensions: {
			persistedQuery: { version: 1, sha256Hash: QUERY_ARTIST_OVERVIEW_HASH },
		},
	}),
});

if (res.status === 429) {
	console.error(`Rate limited. Retry-After: ${res.headers.get("Retry-After")}s`);
	process.exit(1);
}
if (!res.ok) {
	console.error(`Pathfinder error: ${res.status} ${await res.text()}`);
	process.exit(1);
}

const json = await res.json();
const artist = json.data?.artistUnion;
if (!artist) {
	console.log("No artistUnion in response:", JSON.stringify(json, null, 2));
	process.exit(0);
}

console.log("name:", artist.profile?.name);
console.log(
	"avatarImage sources:",
	JSON.stringify(artist.visuals?.avatarImage?.sources ?? [], null, 2),
);
console.log("bio:", artist.profile?.biography?.text ?? null);
