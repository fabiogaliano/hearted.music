// Under Vitest, `cloudflare:workers` is aliased to a stub (see vite.config.ts)
// whose `env` starts empty. Mutating that env injects a fake binding, letting
// us drive `withinRateLimit`'s allow/deny branches without the workerd runtime.
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { clientIpFrom, withinRateLimit } from "../edge-rate-limit";

afterEach(() => {
	workerEnv.TEST_LIMITER = undefined;
});

describe("clientIpFrom", () => {
	it("returns the Cloudflare edge IP header", () => {
		const request = new Request("https://example.test", {
			headers: { "cf-connecting-ip": "203.0.113.7" },
		});
		expect(clientIpFrom(request)).toBe("203.0.113.7");
	});

	it("falls back to a single shared bucket when the header is absent", () => {
		const request = new Request("https://example.test");
		expect(clientIpFrom(request)).toBe("unknown");
	});
});

describe("withinRateLimit", () => {
	it("returns true when the binding reports the request is within limit", async () => {
		workerEnv.TEST_LIMITER = { limit: async () => ({ success: true }) };
		await expect(withinRateLimit("TEST_LIMITER", "203.0.113.7")).resolves.toBe(
			true,
		);
	});

	it("returns false and keys by the caller IP when the limit is exceeded", async () => {
		let receivedKey: string | undefined;
		workerEnv.TEST_LIMITER = {
			limit: async ({ key }: { key: string }) => {
				receivedKey = key;
				return { success: false };
			},
		};
		await expect(withinRateLimit("TEST_LIMITER", "203.0.113.7")).resolves.toBe(
			false,
		);
		expect(receivedKey).toBe("203.0.113.7");
	});

	// Fail-open: a missing/misconfigured binding must never block traffic — the
	// opposite would break local dev and could lock users out in prod.
	it("fails open when the named binding is absent", async () => {
		await expect(withinRateLimit("UNSET_LIMITER", "203.0.113.7")).resolves.toBe(
			true,
		);
	});
});
