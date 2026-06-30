import { PostHog } from "posthog-node";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

/**
 * Product-event capture for the standalone Bun worker.
 *
 * The CF web server has `captureWithWaitUntil` (per-request, tied to the
 * isolate's `waitUntil`), but that path reads `import.meta.env` and is built by
 * Vite — neither applies in the worker. The worker is instead a long-lived
 * process, so a singleton client is the right shape (mirrors the OTel SDK
 * singleton in `posthog-otel.ts`). `flushAt: 1` sends each event promptly so a
 * SIGKILL between events loses at most the one in flight; `shutdownWorkerPostHog`
 * drains the rest on graceful shutdown.
 *
 * Env names follow the worker convention from `posthog-otel.ts`: prefer the
 * plain worker-style names, fall back to the legacy `VITE_` names so an
 * already-configured container doesn't regress.
 */
const apiKey =
	process.env.POSTHOG_PROJECT_TOKEN ??
	process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const configuredHost =
	process.env.POSTHOG_HOST ?? process.env.VITE_PUBLIC_POSTHOG_HOST;

let client: PostHog | null = null;
let initialized = false;

function getClient(): PostHog | null {
	if (initialized) return client;
	initialized = true;

	// Production-only: keep local worker runs out of prod analytics.
	if (process.env.NODE_ENV !== "production") return null;
	if (!apiKey) return null;

	const resolvedHosts = resolvePostHogHosts(configuredHost, {
		strict: process.env.NODE_ENV === "production",
	});
	if (resolvedHosts.kind === "invalid") {
		throw new Error(resolvedHosts.reason);
	}

	client = new PostHog(apiKey, {
		host: resolvedHosts.value.apiHost,
		flushAt: 1,
		flushInterval: 0,
	});
	return client;
}

export function captureWorkerEvent(args: {
	distinctId: string;
	event: string;
	properties?: Record<string, unknown>;
}): void {
	getClient()?.capture(args);
}

export function shutdownWorkerPostHog(): Promise<void> {
	return client?.shutdown() ?? Promise.resolve();
}
