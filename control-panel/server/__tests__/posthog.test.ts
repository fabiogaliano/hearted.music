import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PostHogConfigError,
	PostHogFetchError,
	postHogActivity,
	postHogEventCoverage,
	postHogLatestEvents,
	postHogRouteUsage,
	postHogSourceStatus,
} from "../posthog";
import * as prodCreds from "../prod-creds";

describe("PostHog Adapter", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.spyOn(prodCreds, "getPostHogCreds").mockReturnValue({
			apiKey: "phx_test_key_12345",
			projectId: "185471",
			apiHost: "https://eu.posthog.com",
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("returns PostHogConfigError when API key is missing", async () => {
		vi.spyOn(prodCreds, "getPostHogCreds").mockReturnValue({
			apiKey: null,
			projectId: "185471",
			apiHost: "https://eu.posthog.com",
		});

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogConfigError);
			expect(res.error.message).toContain("Missing POSTHOG_PERSONAL_API_KEY");
		}
	});

	it("returns PostHogConfigError when host is not in allowlist", async () => {
		vi.spyOn(prodCreds, "getPostHogCreds").mockReturnValue({
			apiKey: "phx_test_key_12345",
			projectId: "185471",
			apiHost: "https://malicious.example.com",
		});

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogConfigError);
			expect(res.error.message).toContain("not in allowlist");
		}
	});

	it("returns PostHogConfigError when project ID is invalid", async () => {
		vi.spyOn(prodCreds, "getPostHogCreds").mockReturnValue({
			apiKey: "phx_test_key_12345",
			projectId: "invalid-id-xyz",
			apiHost: "https://eu.posthog.com",
		});

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogConfigError);
			expect(res.error.message).toContain("Invalid POSTHOG_PROJECT_ID");
		}
	});

	it("returns PostHogFetchError on HTTP non-200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response("Unauthorized", {
				status: 401,
				statusText: "Unauthorized",
			}),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr() && res.error instanceof PostHogFetchError) {
			expect(res.error.status).toBe(401);
		}
	});

	it("returns PostHogFetchError on 429 rate limit", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response("Rate limit exceeded", {
				status: 429,
				statusText: "Too Many Requests",
			}),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr() && res.error instanceof PostHogFetchError) {
			expect(res.error.status).toBe(429);
		}
	});

	it("returns PostHogFetchError on oversized response payload", async () => {
		const hugeData = "x".repeat(3 * 1024 * 1024); // 3MB
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(hugeData, {
				status: 200,
				headers: { "content-length": String(hugeData.length) },
			}),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogFetchError);
			expect(res.error.message).toContain("exceeds limit");
		}
	});

	it("returns PostHogFetchError on malformed JSON response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ not_results: 123 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogFetchError);
			expect(res.error.message).toContain("Malformed PostHog query response");
		}
	});

	it("queries and parses postHogActivity successfully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [[42, 180, 55, "2026-08-16T17:00:00.000Z"]],
					columns: ["visitors", "pageviews", "sessions", "max_ts"],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isOk()).toBe(true);
		if (res.isOk()) {
			expect(res.value).toEqual({
				visitors: 42,
				pageviews: 180,
				sessions: 55,
				latestObservedAt: "2026-08-16T17:00:00.000Z",
			});
		}
	});

	it("rejects malformed aggregate values instead of serializing NaN", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [["not-a-number", 180, 55, null]],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isErr()).toBe(true);
		if (res.isErr()) {
			expect(res.error).toBeInstanceOf(PostHogFetchError);
			expect(res.error.message).toContain("Malformed PostHog activity rows");
		}
	});

	it("queries and parses postHogRouteUsage successfully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						["/queue", 120],
						["/playlists", 85],
						["/", 45],
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await postHogRouteUsage(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isOk()).toBe(true);
		if (res.isOk()) {
			expect(res.value).toEqual([
				{ pathname: "/queue", count: 120 },
				{ pathname: "/playlists", count: 85 },
				{ pathname: "/", count: 45 },
			]);
		}
	});

	it("queries and parses postHogEventCoverage successfully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						["onboarding_completed", 15, 15, "2026-08-16T12:00:00Z"],
						["purchase_confirmed", 3, 3, "2026-08-15T10:00:00Z"],
						["match_deck_action", 250, 20, "2026-08-16T16:00:00Z"],
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await postHogEventCoverage(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
		);
		expect(res.isOk()).toBe(true);
		if (res.isOk()) {
			expect(res.value.onboardingCompleted).toBe(15);
			expect(res.value.distinctAccounts.onboardingCompleted).toBe(15);
			expect(res.value.purchaseConfirmed).toBe(3);
			expect(res.value.matchDeckAction).toBe(250);
			expect(res.value.matchSnapshotPublished).toBe(0);
		}
	});

	it("queries and parses postHogLatestEvents successfully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						[
							"uuid-1",
							"song_added_to_playlist",
							"acc-1",
							"2026-08-16T16:30:00Z",
							{ song_id: "s1" },
						],
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await postHogLatestEvents();
		expect(res.isOk()).toBe(true);
		if (res.isOk()) {
			expect(res.value).toEqual([
				{
					id: "uuid-1",
					event: "song_added_to_playlist",
					distinctId: "acc-1",
					timestamp: "2026-08-16T16:30:00Z",
					properties: { song_id: "s1" },
				},
			]);
		}
	});

	it("queries postHogSourceStatus successfully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [["2026-08-16T17:30:00.000Z"]],
					types: [["DateTime64(6, 'UTC')"]],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const status = await postHogSourceStatus();
		expect(status.status).toBe("available");
		if (status.status === "available") {
			expect(status.latestObservedAt).toBe("2026-08-16T17:30:00.000Z");
		}
	});
});
