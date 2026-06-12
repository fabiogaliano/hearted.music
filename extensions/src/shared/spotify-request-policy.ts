import { ConcurrencyLimiter } from "../../../src/lib/shared/utils/concurrency";

const MAX_CONCURRENT_SPOTIFY_REQUESTS = 2;
const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_REQUEST_INTERVAL_MS = 300;

export type SpotifyRequestStats = {
	started: number;
	succeeded: number;
	failed: number;
	rateLimitedResponses: number;
	retryAttempts: number;
	retryAfterSecondsTotal: number;
	wallTimeMs: number;
};

export type SpotifyRequestPolicy = {
	maxConcurrentRequests: number;
	minRequestIntervalMs: number;
	maxRequestIntervalMs: number;
};

const limiter = new ConcurrencyLimiter(
	MAX_CONCURRENT_SPOTIFY_REQUESTS,
	MIN_REQUEST_INTERVAL_MS,
	MAX_REQUEST_INTERVAL_MS,
);

const POLICY: SpotifyRequestPolicy = {
	maxConcurrentRequests: MAX_CONCURRENT_SPOTIFY_REQUESTS,
	minRequestIntervalMs: MIN_REQUEST_INTERVAL_MS,
	maxRequestIntervalMs: MAX_REQUEST_INTERVAL_MS,
};

function createEmptyStats(): SpotifyRequestStats {
	return {
		started: 0,
		succeeded: 0,
		failed: 0,
		rateLimitedResponses: 0,
		retryAttempts: 0,
		retryAfterSecondsTotal: 0,
		wallTimeMs: 0,
	};
}

let stats = createEmptyStats();

export async function runSpotifyRequest<T>(
	request: () => Promise<T>,
): Promise<T> {
	stats.started += 1;
	const startedAt = Date.now();

	try {
		const result = await limiter.run(request);
		stats.succeeded += 1;
		return result;
	} catch (error) {
		stats.failed += 1;
		throw error;
	} finally {
		stats.wallTimeMs += Date.now() - startedAt;
	}
}

export function recordSpotifyRateLimit(retryAfterSeconds: number): void {
	stats.rateLimitedResponses += 1;
	stats.retryAttempts += 1;
	stats.retryAfterSecondsTotal += retryAfterSeconds;
}

export function resetSpotifyRequestStats(): void {
	stats = createEmptyStats();
}

export function snapshotSpotifyRequestStats(): SpotifyRequestStats {
	return { ...stats };
}

export function getSpotifyRequestPolicy(): SpotifyRequestPolicy {
	return POLICY;
}
