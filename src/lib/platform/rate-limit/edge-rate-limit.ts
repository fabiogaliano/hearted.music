/**
 * Cloudflare Workers native rate limiting for raw file-route handlers.
 *
 * TanStack's `createMiddleware` is typed for server functions, not for file
 * route `handlers`, so routes like /api/billing-bridge guard themselves by
 * calling this helper. Counters live in Cloudflare's edge rate-limit binding
 * because Worker isolates share no memory between requests — an in-process
 * counter would reset on every cold isolate and silently never limit.
 *
 * The binding is reached through `cloudflare:workers` (the same module the
 * PostHog helper uses for `waitUntil`), not through `@/env`: bindings are live
 * runtime objects, never string env vars.
 */

// Minimal shape of CF's RateLimit binding. Declared locally so we don't depend
// on `wrangler types` output, which isn't committed in this repo.
interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Per-request client IP. Cloudflare sets `cf-connecting-ip` on every edge
 * request; the fallback collapses absent headers (local dev) into one shared
 * bucket instead of throwing.
 */
export function clientIpFrom(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * True when the request is within the limit. Fails open — returns true — when
 * the binding is unavailable (local Node dev without the CF runtime), mirroring
 * the PostHog helper's graceful fallback so dev iteration isn't blocked.
 * Returns false only when Cloudflare actively reports the limit exceeded.
 */
export async function withinRateLimit(
	bindingName: string,
	key: string,
): Promise<boolean> {
	try {
		const { env } = await import("cloudflare:workers");
		const limiter = env[bindingName] as RateLimitBinding | undefined;
		if (!limiter) return true;
		const { success } = await limiter.limit({ key });
		return success;
	} catch {
		return true;
	}
}
