export const EXTENSION_SYNC_ALREADY_RUNNING = "sync_already_running" as const;
export const EXTENSION_SYNC_COOLDOWN = "sync_cooldown" as const;
export const EXTENSION_SYNC_UNKNOWN_FAILURE = "unknown" as const;
export const EXTENSION_SYNC_PAYLOAD_TOO_LARGE = "sync_payload_too_large" as const;

// Single source of truth for the union below — consumers (e.g. the status
// route's diagnostic zod schema) derive their enum from this array instead of
// hand-listing codes, so the two can't drift apart again.
export const EXTENSION_SYNC_BACKEND_FAILURE_CODES = [
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
	EXTENSION_SYNC_UNKNOWN_FAILURE,
	EXTENSION_SYNC_PAYLOAD_TOO_LARGE,
] as const;

export type ExtensionSyncBackendFailureCode =
	(typeof EXTENSION_SYNC_BACKEND_FAILURE_CODES)[number];

export type ExtensionSyncBackendFailure = {
	status: number;
	code: ExtensionSyncBackendFailureCode;
	message: string | null;
	retryAfterSeconds: number | null;
};

export type ExtensionSyncRequestResult =
	| {
			ok: true;
			count: number;
			backendResult?: unknown;
	  }
	| {
			ok: false;
			source: "backend";
			count: number;
			backendFailure: ExtensionSyncBackendFailure;
	  }
	| {
			ok: false;
			source: "extension";
			error: string;
	  };
