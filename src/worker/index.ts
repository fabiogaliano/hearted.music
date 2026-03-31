import { Result } from "better-result";
import {
	markDeadLibraryProcessingJobs,
	sweepStaleLibraryProcessingJobs,
} from "@/lib/data/jobs";
import { workerConfig } from "./config";
import { setShuttingDown, setUnhealthy, startHealthServer } from "./health";
import { startKeepAlive } from "./keep-alive";
import { log } from "./logger";
import { getActiveJobCount, startPolling, stopPolling } from "./poll";

function startSweep(): { stop: () => void } {
	const interval = setInterval(async () => {
		const swept = await sweepStaleLibraryProcessingJobs(
			workerConfig.staleThreshold,
		);
		if (Result.isError(swept)) {
			log.error("sweep-error", { error: swept.error.message });
		} else if (swept.value.length > 0) {
			log.info("swept-stale-jobs", {
				count: swept.value.length,
				jobIds: swept.value.map((j) => j.id),
			});
		}

		const dead = await markDeadLibraryProcessingJobs(
			workerConfig.staleThreshold,
		);
		if (Result.isError(dead)) {
			log.error("dead-letter-error", { error: dead.error.message });
		} else if (dead.value.length > 0) {
			log.warn("dead-lettered-jobs", {
				count: dead.value.length,
				jobIds: dead.value.map((j) => j.id),
			});
		}
	}, workerConfig.sweepIntervalMs);

	return { stop: () => clearInterval(interval) };
}

let draining = false;

async function main() {
	log.info("worker-starting", { config: workerConfig });

	const healthServer = startHealthServer();
	log.info("health-server-started", { port: workerConfig.healthPort });

	const keepAlive = startKeepAlive();
	const sweep = startSweep();

	const shutdown = async (signal: string) => {
		if (draining) return;
		draining = true;
		log.info("shutdown-initiated", { signal });

		setShuttingDown();
		stopPolling();
		keepAlive.stop();
		sweep.stop();

		const deadline = Date.now() + workerConfig.drainTimeoutMs;
		while (getActiveJobCount() > 0 && Date.now() < deadline) {
			log.info("draining", {
				activeJobs: getActiveJobCount(),
				remainingMs: deadline - Date.now(),
			});
			await Bun.sleep(1000);
		}

		if (getActiveJobCount() > 0) {
			log.warn("drain-timeout", { activeJobs: getActiveJobCount() });
		}

		healthServer.stop();
		log.info("worker-stopped");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	await startPolling();

	if (!draining) {
		log.error("poll-loop-exited-unexpectedly");
		setUnhealthy();
		process.exit(1);
	}
}

main().catch((err) => {
	log.error("worker-fatal", { error: String(err) });
	setUnhealthy();
	process.exit(1);
});
