import { PostHog } from "posthog-node";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

/**
 * Per-request PostHog client for Cloudflare Workers.
 *
 * Why not a singleton: CF Workers isolates can be reused or torn down between
 * requests with no warning. A long-lived singleton that survives across
 * requests but gets discarded mid-flush silently drops events. PostHog's
 * current Workers guidance is to instantiate per-request and tie the flush
 * lifetime to `ctx.waitUntil()`.
 *
 * Pair this with `captureWithWaitUntil` (below) so the network call survives
 * past the Response return without blocking the user.
 */
export function createPostHogClient(): PostHog | null {
	// Production-only: keep dev runs out of prod analytics.
	if (!import.meta.env.PROD) return null;

	const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
	if (!apiKey) return null;

	const resolvedHosts = resolvePostHogHosts(
		import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
		{ strict: import.meta.env.PROD },
	);
	if (resolvedHosts.kind === "invalid") {
		throw new Error(resolvedHosts.reason);
	}

	return new PostHog(apiKey, {
		host: resolvedHosts.value.apiHost,
		flushAt: 1,
		flushInterval: 0,
	});
}

interface CaptureArgs {
	distinctId: string;
	event: string;
	properties?: Record<string, unknown>;
	groups?: Record<string, string>;
}

/**
 * Captures one event and flushes immediately, hooked into the Worker's
 * waitUntil so the network round-trip completes after the Response returns.
 *
 * Falls back to a fire-and-forget flush if `cloudflare:workers` isn't
 * available (e.g. local Node dev without the CF vite plugin runtime). In dev
 * this is acceptable; in prod on CF Workers waitUntil resolves correctly.
 */
export async function captureWithWaitUntil(args: CaptureArgs): Promise<void> {
	const client = createPostHogClient();
	if (!client) return;

	client.capture(args);
	const flushPromise = client.shutdown();

	try {
		const { waitUntil } = await import("cloudflare:workers");
		waitUntil(flushPromise);
	} catch {
		// Not running in a CF Workers runtime — fall back to awaiting inline.
		// Acceptable in local dev; the request just waits ~50ms longer.
		await flushPromise;
	}
}
