import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postSyncPayload } from "../sync-upload";

describe("postSyncPayload", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("sends gzip-compressed JSON with no Content-Encoding header", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		vi.stubGlobal("fetch", fetchMock);

		const body = {
			likedSongs: [{ id: "a" }],
			playlists: [],
			playlistTracks: [],
		};
		await postSyncPayload("tok", "https://api.hearted.music", body);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.hearted.music/api/extension/sync");
		expect(init.method).toBe("POST");

		const headers = new Headers(init.headers);
		expect(headers.get("Content-Type")).toBe("application/gzip");
		expect(headers.get("Authorization")).toBe("Bearer tok");
		// Cloudflare's front line auto-decompresses bodies that declare
		// Content-Encoding, which would corrupt this scheme — regression pin.
		expect(headers.has("Content-Encoding")).toBe(false);

		const compressedBytes = Buffer.from(await init.body.arrayBuffer());
		const decompressed = gunzipSync(compressedBytes).toString("utf8");
		expect(JSON.parse(decompressed)).toEqual(body);
	});
});
