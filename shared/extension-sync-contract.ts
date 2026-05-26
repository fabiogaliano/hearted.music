export const EXTENSION_SYNC_ALREADY_RUNNING = "sync_already_running" as const;
export const EXTENSION_SYNC_COOLDOWN = "sync_cooldown" as const;
export const EXTENSION_SYNC_UNKNOWN_FAILURE = "unknown" as const;

export type ExtensionSyncBackendFailureCode =
	| typeof EXTENSION_SYNC_ALREADY_RUNNING
	| typeof EXTENSION_SYNC_COOLDOWN
	| typeof EXTENSION_SYNC_UNKNOWN_FAILURE;

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
