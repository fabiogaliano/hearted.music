import { describe, expect, it } from "vitest";
import {
	type FetchLike,
	guardServerFnFetch,
	type ServerFnHttpError,
} from "@/lib/platform/server-fn/guarded-fetch";

function fetchReturning(response: Response): FetchLike {
	return async () => response;
}

const CLOUDFLARE_1102_JSON = JSON.stringify({
	success: false,
	errors: [{ code: 1102, message: "Worker exceeded resource limits" }],
});

describe("guardServerFnFetch", () => {
	// Regression: 2026-10-17 a 503 JSON error page resolved getLikedSongsPage to
	// undefined, which the infinite query stored as a page and crashed on.
	it("rejects a non-OK JSON response that Start would otherwise treat as a success envelope", async () => {
		const guarded = guardServerFnFetch(
			fetchReturning(
				new Response(CLOUDFLARE_1102_JSON, {
					status: 503,
					headers: { "content-type": "application/json" },
				}),
			),
		);

		await expect(guarded("/_serverFn/x")).rejects.toMatchObject({
			name: "ServerFnHttpError",
			status: 503,
			bodyPreview: expect.stringContaining("1102"),
		} satisfies Partial<ServerFnHttpError>);
	});

	it("passes Start's own serialized errors through for the client to deserialize", async () => {
		const response = new Response("{}", {
			status: 500,
			headers: {
				"content-type": "application/json",
				"x-tss-serialized": "true",
			},
		});

		await expect(
			guardServerFnFetch(fetchReturning(response))("/x"),
		).resolves.toBe(response);
	});

	it("passes a raw Response a server fn returned with an error status", async () => {
		const response = new Response("no", {
			status: 429,
			headers: { "x-tss-raw": "true" },
		});

		await expect(
			guardServerFnFetch(fetchReturning(response))("/x"),
		).resolves.toBe(response);
	});

	it("passes a notFound() 404 through so isNotFound still sees it", async () => {
		const response = new Response(JSON.stringify({ isNotFound: true }), {
			status: 404,
			headers: { "content-type": "application/json" },
		});

		await expect(
			guardServerFnFetch(fetchReturning(response))("/x"),
		).resolves.toBe(response);
	});

	it("returns a successful response with its body stream unread", async () => {
		const response = new Response('{"t":10}', {
			status: 200,
			headers: {
				"content-type": "application/json",
				"x-tss-serialized": "true",
			},
		});

		const result = await guardServerFnFetch(fetchReturning(response))("/x");

		expect(result).toBe(response);
		expect(result.bodyUsed).toBe(false);
	});
});
