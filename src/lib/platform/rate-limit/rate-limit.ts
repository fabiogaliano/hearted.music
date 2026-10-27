/**
 * In-process fixed-window rate limiting.
 *
 * Counters live in this process's memory: the app runs as one long-lived Bun
 * process, so a restart resets every window. That is acceptable for these
 * limiters, which only blunt floods; none guards money or entitlements.
 */

// Requests allowed per key per window.
const LIMITS = {
	BILLING_LIMITER: 100,
	SENTRY_TUNNEL_LIMITER: 120,
	ACCOUNT_EVENTS_TOKEN_LIMITER: 100,
	WAITLIST_LIMITER: 5,
} as const;

const WINDOW_MS = 60_000;

type LimiterName = keyof typeof LIMITS;

// One window per limiter, not per key: dropping the whole map when the window
// rolls over bounds memory to the keys seen in a single window, with no sweep.
const windows = new Map<
	LimiterName,
	{ startedAt: number; counts: Map<string, number> }
>();

/**
 * Per-request client IP. Trustworthy only because the origin accepts traffic
 * from Cloudflare IPs alone, so a client can't set this header itself. The
 * fallback collapses absent headers (local dev) into one shared bucket.
 */
export function clientIpFrom(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** True when this request for `key` is within the limiter's budget. */
export async function withinRateLimit(
	name: LimiterName,
	key: string,
): Promise<boolean> {
	const now = Date.now();
	let window = windows.get(name);
	if (!window || now - window.startedAt >= WINDOW_MS) {
		window = { startedAt: now, counts: new Map() };
		windows.set(name, window);
	}
	const count = (window.counts.get(key) ?? 0) + 1;
	window.counts.set(key, count);
	return count <= LIMITS[name];
}
