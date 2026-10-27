import { captureException } from "@sentry/core";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { shutdownServerPostHog } from "@/lib/observability/posthog-server";
import { drainAfterResponseWork } from "@/lib/platform/process/after-response";

export default createServerEntry({
	async fetch(request: Request) {
		try {
			return await handler.fetch(request);
		} catch (err) {
			captureException(err, { tags: { source: "server-entry" } });
			throw err;
		}
	},
});

/**
 * Called by src/serve.ts on SIGTERM once the server stops taking requests.
 * Exported from the bundle because the after-response set and the PostHog
 * client live inside it, out of src/serve.ts's reach.
 */
export async function drainServerWork(): Promise<void> {
	await drainAfterResponseWork();
	await shutdownServerPostHog();
}
