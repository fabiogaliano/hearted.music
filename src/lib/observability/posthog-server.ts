import { PostHog } from "posthog-node";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

// One client per process: it batches events and flushes on its own interval;
// `shutdownServerPostHog` sends the remainder on SIGTERM (src/serve.ts).
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
	if (client !== undefined) return client;

	// Production-only: keep dev runs out of prod analytics.
	const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
	if (!import.meta.env.PROD || !apiKey) {
		client = null;
		return client;
	}

	const resolvedHosts = resolvePostHogHosts(
		import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
		{ strict: import.meta.env.PROD },
	);
	if (resolvedHosts.kind === "invalid") {
		throw new Error(resolvedHosts.reason);
	}

	client = new PostHog(apiKey, { host: resolvedHosts.value.apiHost });
	return client;
}

export function captureServerEvent(args: {
	distinctId: string;
	event: string;
	properties?: Record<string, unknown>;
	groups?: Record<string, string>;
}): void {
	getClient()?.capture(args);
}

export async function shutdownServerPostHog(): Promise<void> {
	await client?.shutdown();
}
