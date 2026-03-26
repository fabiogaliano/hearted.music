export const workerConfig = {
	concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
	pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000),
	heartbeatIntervalMs: Number(
		process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 30000,
	),
	staleThreshold: process.env.WORKER_STALE_THRESHOLD ?? "5 minutes",
	sweepIntervalMs: Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 60000),
	drainTimeoutMs: Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30000),
	healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 3002),
	enrichmentMaxChunks: Number(process.env.WORKER_ENRICHMENT_MAX_CHUNKS ?? 0),
};
