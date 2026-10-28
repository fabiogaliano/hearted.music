import { captureServerError } from "@/lib/observability/capture-server-error";

// Tracked so a container stop doesn't cut this work off: src/serve.ts drains
// the set on SIGTERM once the server has stopped taking requests.
const pending = new Set<Promise<void>>();

/** Runs work the response must not wait for; failures go to Sentry. */
export function runAfterResponse(work: Promise<unknown>): void {
	const tracked = work.then(
		() => undefined,
		(error: unknown) => {
			captureServerError(error, {
				area: "server",
				operation: "run_after_response",
			});
		},
	);
	pending.add(tracked);
	void tracked.finally(() => pending.delete(tracked));
}

export async function drainAfterResponseWork(): Promise<void> {
	while (pending.size > 0) {
		await Promise.all(pending);
	}
}
