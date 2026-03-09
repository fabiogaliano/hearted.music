import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/pathfinder", () => ({
	queryPathfinder: vi.fn(),
}));

vi.mock("../shared/hash-registry", () => ({
	getHash: vi.fn().mockResolvedValue("mock-hash"),
	DEFAULT_HASHES: {},
}));

const globalAny = globalThis as any;
globalAny.chrome = {
	storage: {
		local: {
			get: vi.fn().mockResolvedValue({}),
			set: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		},
	},
};

describe("mutations", () => {
	let queryPathfinder: ReturnType<typeof vi.fn>;
	let addToPlaylist: typeof import("../shared/spotify-client/mutations").addToPlaylist;
	let removeFromPlaylist: typeof import("../shared/spotify-client/mutations").removeFromPlaylist;

	beforeEach(async () => {
		vi.clearAllMocks();
		const pathfinder = await import("../shared/pathfinder");
		queryPathfinder = vi.mocked(pathfinder.queryPathfinder);
		const mutations = await import("../shared/spotify-client/mutations");
		addToPlaylist = mutations.addToPlaylist;
		removeFromPlaylist = mutations.removeFromPlaylist;
	});

	describe("addToPlaylist", () => {
		it("sends correct Pathfinder query shape", async () => {
			queryPathfinder.mockResolvedValueOnce({
				data: {
					addItemsToPlaylist: { __typename: "AddItemsToPlaylistResponse" },
				},
			});

			const result = await addToPlaylist(
				"token-123",
				"spotify:playlist:abc",
				["spotify:track:1", "spotify:track:2"],
				"TOP_OF_PLAYLIST",
			);

			expect(queryPathfinder).toHaveBeenCalledWith(
				"token-123",
				"addToPlaylist",
				{
					playlistUri: "spotify:playlist:abc",
					playlistItemUris: ["spotify:track:1", "spotify:track:2"],
					newPosition: {
						moveType: "TOP_OF_PLAYLIST",
						fromUid: null,
					},
				},
			);
			expect(result).toEqual({ typename: "AddItemsToPlaylistResponse" });
		});

		it("defaults position to BOTTOM_OF_PLAYLIST", async () => {
			queryPathfinder.mockResolvedValueOnce({
				data: {
					addItemsToPlaylist: { __typename: "Success" },
				},
			});

			await addToPlaylist("token", "spotify:playlist:x", ["spotify:track:1"]);

			expect(queryPathfinder).toHaveBeenCalledWith(
				"token",
				"addToPlaylist",
				expect.objectContaining({
					newPosition: { moveType: "BOTTOM_OF_PLAYLIST", fromUid: null },
				}),
			);
		});
	});

	describe("removeFromPlaylist", () => {
		it("sends correct Pathfinder query shape", async () => {
			queryPathfinder.mockResolvedValueOnce({
				data: {
					removeItemsFromPlaylist: { __typename: "RemoveItemsResponse" },
				},
			});

			const result = await removeFromPlaylist(
				"token-456",
				"spotify:playlist:def",
				["uid-1", "uid-2"],
			);

			expect(queryPathfinder).toHaveBeenCalledWith(
				"token-456",
				"removeFromPlaylist",
				{
					playlistUri: "spotify:playlist:def",
					uids: ["uid-1", "uid-2"],
				},
			);
			expect(result).toEqual({ typename: "RemoveItemsResponse" });
		});
	});
});

describe("reads — queryArtistOverview", () => {
	let queryPathfinder: ReturnType<typeof vi.fn>;
	let queryArtistOverview: typeof import("../shared/spotify-client/reads").queryArtistOverview;

	beforeEach(async () => {
		vi.clearAllMocks();
		const pathfinder = await import("../shared/pathfinder");
		queryPathfinder = vi.mocked(pathfinder.queryPathfinder);
		const reads = await import("../shared/spotify-client/reads");
		queryArtistOverview = reads.queryArtistOverview;
	});

	it("extracts id, name, and avatar images from response", async () => {
		queryPathfinder.mockResolvedValueOnce({
			data: {
				artistUnion: {
					id: "artist-id-1",
					profile: { name: "Lorde" },
					visuals: {
						avatarImage: {
							sources: [
								{
									url: "https://img.spotify.com/640.jpg",
									width: 640,
									height: 640,
								},
								{
									url: "https://img.spotify.com/320.jpg",
									width: 320,
									height: 320,
								},
							],
						},
					},
				},
			},
		});

		const result = await queryArtistOverview(
			"token-art",
			"spotify:artist:lorde",
			"en",
		);

		expect(result).toEqual({
			id: "artist-id-1",
			name: "Lorde",
			avatarImages: [
				{ url: "https://img.spotify.com/640.jpg", width: 640, height: 640 },
				{ url: "https://img.spotify.com/320.jpg", width: 320, height: 320 },
			],
		});
	});

	it("handles null avatarImage gracefully", async () => {
		queryPathfinder.mockResolvedValueOnce({
			data: {
				artistUnion: {
					id: "artist-id-2",
					profile: { name: "Unknown Artist" },
					visuals: { avatarImage: null },
				},
			},
		});

		const result = await queryArtistOverview(
			"token-art",
			"spotify:artist:unknown",
		);

		expect(result.avatarImages).toEqual([]);
	});

	it("passes locale and uri as variables", async () => {
		queryPathfinder.mockResolvedValueOnce({
			data: {
				artistUnion: {
					id: "a",
					profile: { name: "N" },
					visuals: { avatarImage: null },
				},
			},
		});

		await queryArtistOverview("tok", "spotify:artist:x", "sv");

		expect(queryPathfinder).toHaveBeenCalledWith("tok", "queryArtistOverview", {
			uri: "spotify:artist:x",
			locale: "sv",
		});
	});

	it("defaults locale to 'en'", async () => {
		queryPathfinder.mockResolvedValueOnce({
			data: {
				artistUnion: {
					id: "a",
					profile: { name: "N" },
					visuals: { avatarImage: null },
				},
			},
		});

		await queryArtistOverview("tok", "spotify:artist:x");

		expect(queryPathfinder).toHaveBeenCalledWith("tok", "queryArtistOverview", {
			uri: "spotify:artist:x",
			locale: "en",
		});
	});
});

describe("playlist-v2", () => {
	let originalFetch: typeof globalThis.fetch;
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch as typeof globalThis.fetch;
		vi.resetModules();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("createPlaylist", () => {
		it("performs two-step create: playlist creation + rootlist ADD", async () => {
			mockFetch
				.mockResolvedValueOnce(new Response(null, { status: 200 }))
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							uri: "spotify:playlist:new123",
							revision: "rev-a",
						}),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ revision: "rev-b" }), { status: 200 }),
				);

			const { createPlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const result = await createPlaylist("tok-create", "My List", "user-1");

			expect(result).toEqual({
				uri: "spotify:playlist:new123",
				revision: "rev-a",
			});

			const createCall = mockFetch.mock.calls[1];
			expect(createCall[0]).toContain("/playlist/v2/playlist");
			const createBody = JSON.parse(createCall[1].body);
			expect(createBody.ops[0].kind).toBe("UPDATE_LIST_ATTRIBUTES");
			expect(
				createBody.ops[0].updateListAttributes.newAttributes.values.name,
			).toBe("My List");

			const rootlistCall = mockFetch.mock.calls[2];
			expect(rootlistCall[0]).toContain(
				"/playlist/v2/user/user-1/rootlist/changes",
			);
			const rootlistBody = JSON.parse(rootlistCall[1].body);
			expect(rootlistBody.deltas[0].ops[0].kind).toBe("ADD");
			expect(rootlistBody.deltas[0].ops[0].add.items[0].uri).toBe(
				"spotify:playlist:new123",
			);
		});
	});

	describe("host resolution with fallback", () => {
		it("falls back to secondary host when primary fails", async () => {
			mockFetch
				.mockRejectedValueOnce(new Error("Network error"))
				.mockResolvedValueOnce(new Response(null, { status: 200 }))
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ uri: "spotify:playlist:fb", revision: "rev-fb" }),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ revision: "rev-rl" }), { status: 200 }),
				);

			const { createPlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const result = await createPlaylist(
				"tok-fb",
				"Fallback Playlist",
				"user-fb",
			);

			expect(result.uri).toBe("spotify:playlist:fb");

			const createCallUrl = mockFetch.mock.calls[2][0];
			expect(createCallUrl).toContain("gew4-spclient.spotify.com");
		});

		it("uses primary host when it responds successfully", async () => {
			mockFetch
				.mockResolvedValueOnce(new Response(null, { status: 200 }))
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ uri: "spotify:playlist:p", revision: "rev-p" }),
						{ status: 200 },
					),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ revision: "rev-p2" }), { status: 200 }),
				);

			const { createPlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			await createPlaylist("tok-p", "Primary", "user-p");

			const createCallUrl = mockFetch.mock.calls[1][0];
			expect(createCallUrl).toContain("spclient.wg.spotify.com");
		});
	});

	describe("updatePlaylist", () => {
		it("sends UPDATE_LIST_ATTRIBUTES delta with name and description", async () => {
			mockFetch
				.mockResolvedValueOnce(new Response(null, { status: 200 }))
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ revision: "rev-upd" }), {
						status: 200,
					}),
				);

			const { updatePlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const result = await updatePlaylist("tok-upd", "playlist-id", {
				name: "Renamed",
				description: "New desc",
			});

			expect(result).toEqual({ revision: "rev-upd" });

			const updateCall = mockFetch.mock.calls[1];
			expect(updateCall[0]).toContain(
				"/playlist/v2/playlist/playlist-id/changes",
			);
			const body = JSON.parse(updateCall[1].body);
			expect(body.deltas[0].ops[0].kind).toBe("UPDATE_LIST_ATTRIBUTES");
			expect(
				body.deltas[0].ops[0].updateListAttributes.newAttributes.values,
			).toEqual({
				name: "Renamed",
				description: "New desc",
			});
		});
	});

	describe("deletePlaylist", () => {
		it("sends REM delta to rootlist", async () => {
			mockFetch
				.mockResolvedValueOnce(new Response(null, { status: 200 }))
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ revision: "rev-del" }), {
						status: 200,
					}),
				);

			const { deletePlaylist } = await import(
				"../shared/spotify-client/playlist-v2"
			);

			const result = await deletePlaylist(
				"tok-del",
				"spotify:playlist:to-delete",
				"user-del",
			);

			expect(result).toEqual({ revision: "rev-del" });

			const deleteCall = mockFetch.mock.calls[1];
			expect(deleteCall[0]).toContain(
				"/playlist/v2/user/user-del/rootlist/changes",
			);
			const body = JSON.parse(deleteCall[1].body);
			expect(body.deltas[0].ops[0].kind).toBe("REM");
			expect(body.deltas[0].ops[0].rem.items[0].uri).toBe(
				"spotify:playlist:to-delete",
			);
		});
	});
});
