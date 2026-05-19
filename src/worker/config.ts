const MAX_WORKER_CONCURRENCY = 20;

function parsePositiveIntegerEnv(
	value: string | undefined,
	fallback: number,
): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

export const workerConfig = {
	concurrency: Math.min(
		parsePositiveIntegerEnv(process.env.WORKER_CONCURRENCY, 2),
		MAX_WORKER_CONCURRENCY,
	),
	pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000),
	heartbeatIntervalMs: Number(
		process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 30_000,
	),
	staleThreshold: process.env.WORKER_STALE_THRESHOLD ?? "5 minutes",
	sweepIntervalMs: Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 60_000),
	drainTimeoutMs: Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30_000),
	healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 3_002),
};
