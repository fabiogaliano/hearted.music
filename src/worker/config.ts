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
	// Extension sync is woken primarily by LISTEN/NOTIFY (sub-second), so its
	// poll loop only needs to be a safety net for NOTIFY's at-most-once delivery
	// — a much longer interval than the library-processing loop.
	extensionSyncPollIntervalMs: Number(
		process.env.WORKER_EXTENSION_SYNC_POLL_INTERVAL_MS ?? 30_000,
	),
	heartbeatIntervalMs: Number(
		process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 30_000,
	),
	staleThreshold: process.env.WORKER_STALE_THRESHOLD ?? "5 minutes",
	sweepIntervalMs: Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 60_000),
	// Must exceed the longest expected job (enrichment runs embeddings + LLM
	// analysis for minutes) so a deploy can drain in-flight work instead of
	// killing it and stranding the row in `processing` until the 5-minute stale
	// sweep. Pair with a Coolify container stop grace period above this value —
	// the orchestrator SIGKILLs after the grace period regardless of this timeout.
	drainTimeoutMs: Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 600_000),
	healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 3_002),
	// Optional egress proxy for yt-dlp's YouTube calls in the audio-feature
	// backfill. YouTube bot-gates the datacenter IP, so prod points this at a
	// clean-reputation proxy (e.g. a Cloudflare WARP SOCKS5 sidecar). Unset =
	// direct, and only yt-dlp is routed through it — not the worker's other egress.
	ytdlpProxy: process.env.YTDLP_PROXY?.trim() || undefined,
};
