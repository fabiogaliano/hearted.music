import { describe, expect, it } from "vitest";
import { DEFAULT_HASHES } from "../shared/hash-registry";

const TOKEN = (globalThis as any).process?.env?.SPOTIFY_TOKEN as
	| string
	| undefined;
const describeIf = TOKEN ? describe : describe.skip;

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";

async function queryPathfinder<T>(
	operationName: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const sha256Hash = DEFAULT_HASHES[operationName];
	if (!sha256Hash) throw new Error(`No hash for operation: ${operationName}`);

	const res = await fetch(PATHFINDER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			variables,
			operationName,
			extensions: { persistedQuery: { version: 1, sha256Hash } },
		}),
	});

	if (!res.ok) {
		throw new Error(`Pathfinder ${res.status}: ${operationName}`);
	}

	return res.json() as Promise<T>;
}

describeIf("live contract: Pathfinder API", () => {
	it("profileAttributes returns valid profile shape", async () => {
		const res = await queryPathfinder<any>("profileAttributes", {});

		const profile = res.data?.me?.profile;
		expect(profile).toBeDefined();
		expect(profile.uri).toMatch(/^spotify:user:/);
		expect(typeof profile.name).toBe("string");
		expect(typeof profile.username).toBe("string");
	});

	it("fetchLibraryTracks returns valid track shape", async () => {
		const res = await queryPathfinder<any>("fetchLibraryTracks", {
			offset: 0,
			limit: 1,
		});

		const tracks = res.data?.me?.library?.tracks;
		expect(tracks).toBeDefined();
		expect(typeof tracks.totalCount).toBe("number");
		expect(Array.isArray(tracks.items)).toBe(true);
	});

	it("queryArtistOverview returns valid artist shape", async () => {
		const res = await queryPathfinder<any>("queryArtistOverview", {
			uri: "spotify:artist:06HL4z0CvFAxyc27GXpf02",
			locale: "en",
		});

		const artist = res.data?.artistUnion;
		expect(artist).toBeDefined();
		expect(typeof artist.id).toBe("string");
		expect(typeof artist.profile?.name).toBe("string");
		expect(artist.visuals).toBeDefined();
	});
});

describeIf("live contract: Schema Anchors", () => {
	// These tests assert that specific field paths still exist in Pathfinder responses.
	// A failure here means Spotify changed the response shape, not just the hash.
	// Anchored on stable public URIs unlikely to disappear.

	it("queryArtistOverview [Taylor Swift] — top-level shape and nullable fields", async () => {
		const res = await queryPathfinder<any>("queryArtistOverview", {
			uri: "spotify:artist:06HL4z0CvFAxyc27GXpf02",
			locale: "en",
		});

		const a = res.data?.artistUnion;
		expect(a).toBeDefined();

		// Core identity
		expect(typeof a.id).toBe("string");
		expect(typeof a.profile.name).toBe("string");
		expect(typeof a.profile.verified).toBe("boolean");

		// visuals.avatarImage is nullable — key must exist regardless
		expect("avatarImage" in a.visuals).toBe(true);
		if (a.visuals.avatarImage !== null) {
			expect(Array.isArray(a.visuals.avatarImage.sources)).toBe(true);
			const src = a.visuals.avatarImage.sources[0];
			expect(typeof src.url).toBe("string");
			expect(typeof src.width).toBe("number");
			expect(typeof src.height).toBe("number");
		}

		// watchFeedEntrypoint is nullable — key must exist regardless
		expect("watchFeedEntrypoint" in a).toBe(true);

		// Stats
		expect(typeof a.stats.followers).toBe("number");
		expect(typeof a.stats.monthlyListeners).toBe("number");

		// Discography shape
		expect(Array.isArray(a.discography.topTracks.items)).toBe(true);
		expect(Array.isArray(a.discography.albums.items)).toBe(true);
		expect(Array.isArray(a.discography.singles.items)).toBe(true);
		expect(Array.isArray(a.discography.compilations.items)).toBe(true);
	});

	it("fetchPlaylistContents [Today's Top Hits] — track item shape", async () => {
		const res = await queryPathfinder<any>("fetchPlaylistContents", {
			uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
			offset: 0,
			limit: 1,
		});

		const item = res.data?.playlistV2?.content?.items?.[0];
		expect(item).toBeDefined();

		// addedBy can be null for Spotify-added tracks (editorial playlists)
		expect("addedBy" in item).toBe(true);
		if (item.addedBy !== null && item.addedBy.data !== null) {
			expect("avatar" in item.addedBy.data).toBe(true);
		}

		// itemV2 track shape
		const track = item.itemV2?.data;
		expect(typeof track.name).toBe("string");
		expect(typeof track.uri).toBe("string");
		expect(Array.isArray(track.artists.items)).toBe(true);
		expect(Array.isArray(track.albumOfTrack.coverArt.sources)).toBe(true);
		// fetchPlaylistContents uses trackDuration (not duration — differs from fetchLibraryTracks)
		expect(typeof track.trackDuration.totalMilliseconds).toBe("number");
		expect(typeof track.playability.playable).toBe("boolean");
		expect(typeof track.playability.reason).toBe("string");

		// itemV3 visual identity — sixteenByNineCoverImage nullable
		const visual = item.itemV3?.data?.visualIdentityTrait;
		expect("sixteenByNineCoverImage" in visual).toBe(true);
		expect(visual.squareCoverImage).toBeDefined();
	});

	it("fetchLibraryTracks — track shape differs from fetchPlaylistContents", async () => {
		const res = await queryPathfinder<any>("fetchLibraryTracks", {
			offset: 0,
			limit: 1,
		});

		const tracks = res.data?.me?.library?.tracks;
		expect(typeof tracks.totalCount).toBe("number");
		if (tracks.items.length === 0) return;

		const track = tracks.items[0].track?.data;
		expect(Array.isArray(track.albumOfTrack.coverArt.sources)).toBe(true);
		// fetchLibraryTracks uses duration (not trackDuration)
		expect(typeof track.duration.totalMilliseconds).toBe("number");
		// fetchLibraryTracks omits playability.reason
		expect(typeof track.playability.playable).toBe("boolean");
		expect("reason" in track.playability).toBe(false);
	});

	it("profileAttributes — avatar is null or has typed sources", async () => {
		const res = await queryPathfinder<any>("profileAttributes", {});

		const profile = res.data?.me?.profile;
		expect(typeof profile.name).toBe("string");
		expect(typeof profile.username).toBe("string");
		expect(typeof profile.avatarBackgroundColor).toBe("number");

		// avatar is nullable — key must exist regardless
		expect("avatar" in profile).toBe(true);
		if (profile.avatar !== null) {
			expect(Array.isArray(profile.avatar.sources)).toBe(true);
			const src = profile.avatar.sources[0];
			expect(typeof src.url).toBe("string");
			expect(typeof src.width).toBe("number");
			expect(typeof src.height).toBe("number");
		}
	});
});

describeIf("live contract: Hash Registry", () => {
	const MUTATION_OPS = new Set(["addToPlaylist", "removeFromPlaylist"]);

	const MINIMAL_VARIABLES: Record<string, Record<string, unknown>> = {
		profileAttributes: {},
		fetchLibraryTracks: { offset: 0, limit: 1 },
		libraryV3: {
			filters: [],
			order: null,
			textFilter: "",
			features: [],
			limit: 1,
			offset: 0,
			flatten: true,
			expandedFolders: [],
			folderUri: null,
			includeFoldersWhenFlattening: true,
		},
		fetchPlaylistContents: {
			uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
			offset: 0,
			limit: 1,
		},
		queryArtistOverview: {
			uri: "spotify:artist:06HL4z0CvFAxyc27GXpf02",
			locale: "en",
		},
	};

	it("all read-operation hashes resolve successfully", async () => {
		const readOps = Object.keys(DEFAULT_HASHES).filter(
			(op) => !MUTATION_OPS.has(op),
		);

		for (const op of readOps) {
			const variables = MINIMAL_VARIABLES[op] ?? {};
			const res = await fetch(PATHFINDER_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					variables,
					operationName: op,
					extensions: {
						persistedQuery: { version: 1, sha256Hash: DEFAULT_HASHES[op] },
					},
				}),
			});

			const body = await res.json();
			const hasPersistedQueryError =
				body.errors?.some(
					(e: any) =>
						e.message === "PersistedQueryNotFound" ||
						e.extensions?.code === "PERSISTED_QUERY_NOT_FOUND",
				) ?? false;
			expect(
				hasPersistedQueryError,
				`Hash rotated for ${op}: ${DEFAULT_HASHES[op].substring(0, 16)}...`,
			).toBe(false);
		}
	});
});
