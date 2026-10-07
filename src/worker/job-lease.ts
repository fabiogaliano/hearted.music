import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { type Job, updateHeartbeat } from "@/lib/platform/jobs/repository";
import { workerConfig } from "./config";

/**
 * Renews the claim's lease until stopped. `leaseLost` aborts once the renewal
 * reports the lease taken over, so the run can stop before its next side
 * effect instead of finishing work the fenced settle would discard.
 */
export function startHeartbeat(job: Pick<Job, "id" | "attempts">): {
	stop: () => void;
	leaseLost: AbortSignal;
} {
	const lease = new AbortController();
	const interval = setInterval(async () => {
		const result = await updateHeartbeat(job);
		if (Result.isError(result)) {
			log.warn("heartbeat-failed", {
				jobId: job.id,
				error: result.error.message,
			});
			return;
		}
		// The lease was swept and reclaimed or dead-lettered; renewing it can
		// never succeed again.
		if (result.value === "superseded") {
			log.warn("heartbeat-lease-lost", {
				jobId: job.id,
				attempts: job.attempts,
			});
			clearInterval(interval);
			lease.abort();
		}
	}, workerConfig.heartbeatIntervalMs);
	return {
		stop: () => clearInterval(interval),
		leaseLost: lease.signal,
	};
}
