import type { ExtensionSyncBackendFailureCode } from "./extension-sync-contract";

export const EXTENSION_SYNC_DIAGNOSTIC_OUTCOMES = [
	"success",
	"backend_failure",
	"extension_failure",
] as const;

export const EXTENSION_SYNC_DIAGNOSTIC_PHASES = [
	"idle",
	"likedSongs",
	"playlists",
	"playlistTracks",
	"artistImages",
	"uploading",
] as const;

export type ExtensionSyncDiagnosticOutcome =
	(typeof EXTENSION_SYNC_DIAGNOSTIC_OUTCOMES)[number];

export type ExtensionSyncDiagnosticPhase =
	(typeof EXTENSION_SYNC_DIAGNOSTIC_PHASES)[number];

export type ExtensionSyncDiagnosticRequestStats = {
	started: number;
	succeeded: number;
	failed: number;
	rateLimitedResponses: number;
	retryAttempts: number;
	retryAfterSecondsTotal: number;
	wallTimeMs: number;
};

export type ExtensionSyncDiagnosticRequestPolicy = {
	maxConcurrentRequests: number;
	minRequestIntervalMs: number;
	maxRequestIntervalMs: number;
};

export type ExtensionSyncDiagnosticSummary = {
	id: string;
	clientCreatedAt: string;
	extensionVersion: string;
	outcome: ExtensionSyncDiagnosticOutcome;
	phase: ExtensionSyncDiagnosticPhase;
	backendStatus: number | null;
	backendFailureCode: ExtensionSyncBackendFailureCode | null;
	retryAfterSeconds: number | null;
	errorMessage: string | null;
	durationMs: number;
	likedSongsCount: number;
	playlistCount: number;
	playlistsWithTracksCount: number;
	playlistTracksCount: number;
	failedPlaylistTrackFetchCount: number;
	skippedEmptyPlaylistsCount: number;
	requestStats: ExtensionSyncDiagnosticRequestStats;
	requestPolicy: ExtensionSyncDiagnosticRequestPolicy;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isExtensionSyncDiagnosticOutcome(
	value: unknown,
): value is ExtensionSyncDiagnosticOutcome {
	return (
		typeof value === "string" &&
		EXTENSION_SYNC_DIAGNOSTIC_OUTCOMES.some((outcome) => outcome === value)
	);
}

export function isExtensionSyncDiagnosticPhase(
	value: unknown,
): value is ExtensionSyncDiagnosticPhase {
	return (
		typeof value === "string" &&
		EXTENSION_SYNC_DIAGNOSTIC_PHASES.some((phase) => phase === value)
	);
}

export function isExtensionSyncDiagnosticSummary(
	value: unknown,
): value is ExtensionSyncDiagnosticSummary {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string") return false;
	if (typeof value.clientCreatedAt !== "string") return false;
	if (typeof value.extensionVersion !== "string") return false;
	if (!isExtensionSyncDiagnosticOutcome(value.outcome)) return false;
	if (!isExtensionSyncDiagnosticPhase(value.phase)) return false;
	if (
		value.backendStatus !== null &&
		!isNonNegativeNumber(value.backendStatus)
	)
		return false;
	if (
		value.backendFailureCode !== null &&
		typeof value.backendFailureCode !== "string"
	)
		return false;
	if (
		value.retryAfterSeconds !== null &&
		!isNonNegativeNumber(value.retryAfterSeconds)
	)
		return false;
	if (
		value.errorMessage !== null &&
		typeof value.errorMessage !== "string"
	)
		return false;
	if (!isNonNegativeNumber(value.durationMs)) return false;
	if (!isNonNegativeNumber(value.likedSongsCount)) return false;
	if (!isNonNegativeNumber(value.playlistCount)) return false;
	if (!isNonNegativeNumber(value.playlistsWithTracksCount)) return false;
	if (!isNonNegativeNumber(value.playlistTracksCount)) return false;
	if (!isNonNegativeNumber(value.failedPlaylistTrackFetchCount)) return false;
	if (!isNonNegativeNumber(value.skippedEmptyPlaylistsCount)) return false;
	if (!isRecord(value.requestStats)) return false;
	if (!isRecord(value.requestPolicy)) return false;

	const stats = value.requestStats;
	if (!isNonNegativeNumber(stats.started)) return false;
	if (!isNonNegativeNumber(stats.succeeded)) return false;
	if (!isNonNegativeNumber(stats.failed)) return false;
	if (!isNonNegativeNumber(stats.rateLimitedResponses)) return false;
	if (!isNonNegativeNumber(stats.retryAttempts)) return false;
	if (!isNonNegativeNumber(stats.retryAfterSecondsTotal)) return false;
	if (!isNonNegativeNumber(stats.wallTimeMs)) return false;

	const policy = value.requestPolicy;
	if (!isNonNegativeNumber(policy.maxConcurrentRequests)) return false;
	if (!isNonNegativeNumber(policy.minRequestIntervalMs)) return false;
	if (!isNonNegativeNumber(policy.maxRequestIntervalMs)) return false;

	return true;
}
