import { z } from "zod";

export const WORKFLOW_DEV_SETTINGS_STORAGE_KEY =
	"hearted:dev-workflow-settings";

export const WorkflowDevClientSettingsSchema = z.object({
	activeJobsPollMs: z.number().int().min(500).max(15_000),
	jobProgressPollMs: z.number().int().min(500).max(10_000),
});
export type WorkflowDevClientSettings = z.infer<
	typeof WorkflowDevClientSettingsSchema
>;

export const WorkflowDevServerSettingsSchema = z.object({
	enrichmentStageDelayMs: z.number().int().min(0).max(5_000),
	refreshStageDelayMs: z.number().int().min(0).max(5_000),
	preSettlementDelayMs: z.number().int().min(0).max(3_000),
	runUntilIdleMaxJobs: z.number().int().min(1).max(50),
});
export type WorkflowDevServerSettings = z.infer<
	typeof WorkflowDevServerSettingsSchema
>;

export interface WorkflowDevSettings {
	client: WorkflowDevClientSettings;
	server: WorkflowDevServerSettings;
}

export const DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS: WorkflowDevClientSettings = {
	activeJobsPollMs: 2_000,
	jobProgressPollMs: 1_000,
};

export const DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS: WorkflowDevServerSettings = {
	enrichmentStageDelayMs: 0,
	refreshStageDelayMs: 0,
	preSettlementDelayMs: 0,
	runUntilIdleMaxJobs: 20,
};

const listeners = new Set<() => void>();
let cachedSettings: WorkflowDevSettings | null = null;

function canUseLocalStorage(): boolean {
	return typeof window !== "undefined" && "localStorage" in window;
}

export function getDefaultWorkflowDevSettings(): WorkflowDevSettings {
	return {
		client: { ...DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS },
		server: { ...DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS },
	};
}

function normalizeSettings(input: unknown): WorkflowDevSettings {
	if (typeof input !== "object" || input === null) {
		return getDefaultWorkflowDevSettings();
	}

	const clientCandidate = "client" in input ? input.client : undefined;
	const serverCandidate = "server" in input ? input.server : undefined;

	const clientResult =
		WorkflowDevClientSettingsSchema.partial().safeParse(clientCandidate);
	const serverResult =
		WorkflowDevServerSettingsSchema.partial().safeParse(serverCandidate);

	return {
		client: {
			...DEFAULT_WORKFLOW_DEV_CLIENT_SETTINGS,
			...(clientResult.success ? clientResult.data : {}),
		},
		server: {
			...DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS,
			...(serverResult.success ? serverResult.data : {}),
		},
	};
}

export function readWorkflowDevSettings(): WorkflowDevSettings {
	if (cachedSettings !== null) {
		return cachedSettings;
	}

	if (!canUseLocalStorage()) {
		cachedSettings = getDefaultWorkflowDevSettings();
		return cachedSettings;
	}

	try {
		const raw = window.localStorage.getItem(WORKFLOW_DEV_SETTINGS_STORAGE_KEY);
		cachedSettings = normalizeSettings(raw ? JSON.parse(raw) : null);
		return cachedSettings;
	} catch {
		cachedSettings = getDefaultWorkflowDevSettings();
		return cachedSettings;
	}
}

function notifySettingsListeners(): void {
	for (const listener of listeners) {
		listener();
	}
}

function settingsEqual(
	left: WorkflowDevSettings,
	right: WorkflowDevSettings,
): boolean {
	return (
		left.client.activeJobsPollMs === right.client.activeJobsPollMs &&
		left.client.jobProgressPollMs === right.client.jobProgressPollMs &&
		left.server.enrichmentStageDelayMs ===
			right.server.enrichmentStageDelayMs &&
		left.server.refreshStageDelayMs === right.server.refreshStageDelayMs &&
		left.server.preSettlementDelayMs === right.server.preSettlementDelayMs &&
		left.server.runUntilIdleMaxJobs === right.server.runUntilIdleMaxJobs
	);
}

export function writeWorkflowDevSettings(next: WorkflowDevSettings): void {
	const normalized = normalizeSettings(next);
	if (cachedSettings !== null && settingsEqual(cachedSettings, normalized)) {
		return;
	}

	cachedSettings = normalized;

	if (canUseLocalStorage()) {
		try {
			window.localStorage.setItem(
				WORKFLOW_DEV_SETTINGS_STORAGE_KEY,
				JSON.stringify(normalized),
			);
		} catch {
			// Ignore storage failures in dev tooling.
		}
	}

	notifySettingsListeners();
}

export function updateWorkflowDevClientSettings(
	partial: Partial<WorkflowDevClientSettings>,
): void {
	const current = readWorkflowDevSettings();
	writeWorkflowDevSettings({
		...current,
		client: {
			...current.client,
			...partial,
		},
	});
}

export function updateWorkflowDevServerSettings(
	partial: Partial<WorkflowDevServerSettings>,
): void {
	const current = readWorkflowDevSettings();
	writeWorkflowDevSettings({
		...current,
		server: {
			...current.server,
			...partial,
		},
	});
}

export function resetWorkflowDevSettings(): void {
	writeWorkflowDevSettings(getDefaultWorkflowDevSettings());
}

export function subscribeWorkflowDevSettings(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
