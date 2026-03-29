const legacyEnrichmentChunkCap = Number(
	process.env.WORKER_ENRICHMENT_MAX_CHUNKS ?? 0,
);

if (
	legacyEnrichmentChunkCap !== 0 &&
	(process.env.NODE_ENV === "production" || !import.meta.env.DEV)
) {
	throw new Error(
		"WORKER_ENRICHMENT_MAX_CHUNKS is a deprecated dev-only hack. Use guided workflow mode instead.",
	);
}

export const workerConfig = {
	concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
	pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000),
	heartbeatIntervalMs: Number(
		process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 30_000,
	),
	staleThreshold: process.env.WORKER_STALE_THRESHOLD ?? "5 minutes",
	sweepIntervalMs: Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 60_000),
	drainTimeoutMs: Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30_000),
	healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 3_002),
};
