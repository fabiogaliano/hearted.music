import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	removePlaylistCover,
	setPlaylistVisibility,
	uploadPlaylistCover,
} from "../playlist-v2";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

// resolveSpClientHost issues a HEAD probe before the real POSTs.
function headResponse(): Response {
	return {
		ok: true,
		status: 200,
		body: { cancel: () => {} },
	} as unknown as Response;
}

const originalFetch = globalThis.fetch;

describe("uploadPlaylistCover", () => {
	let mockFetch: FetchMock;

	beforeEach(() => {
		mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : String(input);
			const method = (init?.method ?? "GET").toUpperCase();

			if (method === "HEAD") return headResponse();
			if (url.includes("image-upload.spotify.com"))
				return jsonResponse({ uploadToken: "upload-tok-123" });
			if (url.includes("/register-image"))
				return jsonResponse({ picture: "picture-file-id" });
			if (url.includes("/changes"))
				return jsonResponse({ revision: "rev-abc" });

			throw new Error(`unexpected fetch: ${method} ${url}`);
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.clearAllMocks();
	});

	it("uploads bytes, registers the image, then persists the picture id", async () => {
		const result = await uploadPlaylistCover(
			"token-xyz",
			"playlist-id-1",
			"/9j/4AAQSkZJRg==",
		);

		expect(result).toEqual({ revision: "rev-abc", picture: "picture-file-id" });

		const calls = mockFetch.mock.calls.map(([input, init]) => ({
			url: String(input),
			method: (init?.method ?? "GET").toUpperCase(),
		}));
		const posts = calls.filter((c) => c.method === "POST");

		expect(posts[0].url).toBe("https://image-upload.spotify.com/v4/playlist");
		expect(posts[1].url).toContain(
			"/playlist/v2/playlist/playlist-id-1/register-image",
		);
		expect(posts[2].url).toContain(
			"/playlist/v2/playlist/playlist-id-1/changes",
		);
	});

	it("sends the upload token returned by step 1 to register-image", async () => {
		await uploadPlaylistCover("token-xyz", "playlist-id-1", "/9j/4AAQSkZJRg==");

		const registerCall = mockFetch.mock.calls.find(([input]) =>
			String(input).includes("/register-image"),
		);
		expect(registerCall).toBeDefined();
		const body = JSON.parse((registerCall?.[1]?.body as string) ?? "{}");
		expect(body).toEqual({ uploadToken: "upload-tok-123" });
	});

	it("persists the registered picture id via UPDATE_LIST_ATTRIBUTES", async () => {
		await uploadPlaylistCover("token-xyz", "playlist-id-1", "/9j/4AAQSkZJRg==");

		const changesCall = mockFetch.mock.calls.find(([input]) =>
			String(input).includes("/changes"),
		);
		const body = JSON.parse((changesCall?.[1]?.body as string) ?? "{}");
		expect(body.deltas[0].ops[0].kind).toBe("UPDATE_LIST_ATTRIBUTES");
		expect(
			body.deltas[0].ops[0].updateListAttributes.newAttributes.values.picture,
		).toBe("picture-file-id");
	});

	it("strips a data URL prefix before uploading", async () => {
		await uploadPlaylistCover(
			"token-xyz",
			"playlist-id-1",
			"data:image/jpeg;base64,/9j/4AAQSkZJRg==",
		);

		const uploadCall = mockFetch.mock.calls.find(([input]) =>
			String(input).includes("image-upload.spotify.com"),
		);
		const blob = uploadCall?.[1]?.body as Blob;
		// data:image/jpeg;base64,/9j/4AAQSkZJRg== decodes to 10 bytes
		expect(blob.size).toBe(10);
		expect(blob.type).toBe("image/jpeg");
	});

	it("rejects images larger than 10MB before any network call", async () => {
		// Encoded length > 10MB * 4/3 trips the pre-decode guard.
		const oversized = "A".repeat(10 * 1024 * 1024 * 2);

		await expect(
			uploadPlaylistCover("token-xyz", "playlist-id-1", oversized),
		).rejects.toThrow(/too large/i);

		expect(mockFetch).not.toHaveBeenCalled();
	});
});

describe("removePlaylistCover", () => {
	let mockFetch: FetchMock;

	beforeEach(() => {
		mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = (init?.method ?? "GET").toUpperCase();
			if (method === "HEAD") return headResponse();
			return jsonResponse({ revision: "rev-removed" });
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.clearAllMocks();
	});

	it("clears the picture via noValue LIST_PICTURE (not picture: '')", async () => {
		const result = await removePlaylistCover("token-xyz", "playlist-id-1");

		expect(result).toEqual({ revision: "rev-removed" });

		const changesCall = mockFetch.mock.calls.find(([input]) =>
			String(input).includes("/playlist/v2/playlist/playlist-id-1/changes"),
		);
		expect(changesCall).toBeDefined();
		const op = JSON.parse((changesCall?.[1]?.body as string) ?? "{}").deltas[0]
			.ops[0];
		expect(op.kind).toBe("UPDATE_LIST_ATTRIBUTES");
		expect(op.updateListAttributes.newAttributes.noValue).toEqual([
			"LIST_PICTURE",
		]);
		expect(op.updateListAttributes.newAttributes.values).toEqual({});
	});
});

describe("setPlaylistVisibility", () => {
	let mockFetch: FetchMock;

	beforeEach(() => {
		mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = (init?.method ?? "GET").toUpperCase();
			if (method === "HEAD") return headResponse();
			return jsonResponse({ revision: "rev-vis" });
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.clearAllMocks();
	});

	it("sets the public flag via UPDATE_ITEM_ATTRIBUTES on the user rootlist", async () => {
		const result = await setPlaylistVisibility(
			"token-xyz",
			"spotify:playlist:abc",
			"user123",
			false,
		);

		expect(result).toEqual({ revision: "rev-vis" });

		const call = mockFetch.mock.calls.find(([input]) =>
			String(input).includes("/playlist/v2/user/user123/rootlist/changes"),
		);
		expect(call).toBeDefined();
		const op = JSON.parse((call?.[1]?.body as string) ?? "{}").deltas[0].ops[0];
		expect(op.kind).toBe("UPDATE_ITEM_ATTRIBUTES");
		expect(op.updateItemAttributes.newAttributes.values).toEqual({
			public: false,
		});
		expect(op.updateItemAttributes.item).toEqual({
			uri: "spotify:playlist:abc",
		});
	});
});
