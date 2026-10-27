import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIpFrom, withinRateLimit } from "../rate-limit";

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

// WAITLIST_LIMITER allows 5 requests per key per 60 s window.
const WAITLIST_LIMIT = 5;

async function spend(key: string, times: number): Promise<boolean[]> {
	const results: boolean[] = [];
	for (let i = 0; i < times; i++) {
		results.push(await withinRateLimit("WAITLIST_LIMITER", key));
	}
	return results;
}

describe("withinRateLimit", () => {
	// Limiter state is module-level, so each test starts in a fresh window far
	// from the previous test's and uses its own keys.
	let clock = 0;
	beforeEach(() => {
		vi.useFakeTimers();
		clock += 10 * 60_000;
		vi.setSystemTime(clock);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows the limit, then denies the next request in the same window", async () => {
		expect(await spend("ip-a", WAITLIST_LIMIT)).toEqual(
			Array(WAITLIST_LIMIT).fill(true),
		);
		await expect(withinRateLimit("WAITLIST_LIMITER", "ip-a")).resolves.toBe(
			false,
		);
	});

	it("keeps denying until the window ends, then restores the full budget", async () => {
		await spend("ip-b", WAITLIST_LIMIT);

		vi.advanceTimersByTime(59_999);
		await expect(withinRateLimit("WAITLIST_LIMITER", "ip-b")).resolves.toBe(
			false,
		);

		vi.advanceTimersByTime(1);
		expect(await spend("ip-b", WAITLIST_LIMIT)).toEqual(
			Array(WAITLIST_LIMIT).fill(true),
		);
	});

	it("counts each key and each limiter separately", async () => {
		await spend("ip-c", WAITLIST_LIMIT + 1);

		await expect(withinRateLimit("WAITLIST_LIMITER", "ip-d")).resolves.toBe(
			true,
		);
		await expect(withinRateLimit("BILLING_LIMITER", "ip-c")).resolves.toBe(
			true,
		);
	});
});
