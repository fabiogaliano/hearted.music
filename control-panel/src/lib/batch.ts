import { getJson, postJson } from "./api";

export type BatchStatus =
	| "preview"
	| "running"
	| "succeeded"
	| "failed"
	| "partial"
	| "cancelled"
	| "interrupted";

export type BatchTargetStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped"
	| "cancelled"
	| "interrupted";

export interface BatchPreview {
	batchId: string;
	actionType: string;
	total: number;
	eligible: number;
	skipped: number;
	summary: Record<string, number>;
	warnings: string[];
	estimatedActions: number;
	targetsPreview: { targetId: string; label: string | null }[];
	skippedReasons: { reason: string; count: number }[];
}

export interface BatchRun {
	id: string;
	actionType: string;
	status: BatchStatus;
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	cancelled: number;
	createdAt: string;
	committedAt: string | null;
	completedAt: string | null;
}

export interface BatchTarget {
	ordinal: number;
	targetType: string;
	targetId: string;
	targetLabel: string | null;
	status: BatchTargetStatus;
	skipReason: string | null;
	attempts: number;
	result: Record<string, unknown> | null;
	errorMessage: string | null;
	externalId: string | null;
}

export interface BatchView {
	batch: BatchRun | null;
	progress: Record<BatchTargetStatus, number>;
	targets: BatchTarget[];
}

export interface ActiveBatch {
	id: string;
	actionType: string;
	status: BatchStatus;
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	createdAt: string;
	completedAt: string | null;
}

export const BATCH_LABELS: Record<string, string> = {
	"grant-batch": "Grant song access",
	"audio-approve-batch": "Approve audio reviews",
	"instrumental-approve-batch": "Approve instrumental reviews",
	"email-batch": "Send email",
};

export const TERMINAL_STATUSES: ReadonlySet<BatchStatus> = new Set([
	"succeeded",
	"failed",
	"partial",
	"cancelled",
]);

export function previewBatch(
	input: Record<string, unknown> & { actionType: string },
): Promise<BatchPreview> {
	return postJson<BatchPreview>("/api/batches/preview", input);
}

export function commitBatch(
	batchId: string,
	testedDraftHash?: string | null,
): Promise<BatchView> {
	return postJson<BatchView>(`/api/batches/${batchId}/commit`, {
		testedDraftHash: testedDraftHash ?? null,
	});
}

export function getBatch(batchId: string): Promise<BatchView> {
	return getJson<BatchView>(`/api/batches/${batchId}`);
}

export function cancelBatch(batchId: string): Promise<BatchView> {
	return postJson<BatchView>(`/api/batches/${batchId}/cancel`, {});
}

export function resumeBatch(batchId: string): Promise<BatchView> {
	return postJson<BatchView>(`/api/batches/${batchId}/resume`, {});
}

export function retryFailedBatch(batchId: string): Promise<BatchView> {
	return postJson<BatchView>(`/api/batches/${batchId}/retry-failed`, {});
}

export function listActiveBatches(): Promise<{ batches: ActiveBatch[] }> {
	return getJson<{ batches: ActiveBatch[] }>("/api/batches");
}

export interface EmailTestResult {
	ok: boolean;
	draftHash: string;
	externalId: string | null;
}

export function sendEmailTest(
	input: Record<string, unknown>,
): Promise<EmailTestResult> {
	return postJson<EmailTestResult>("/api/email/test", input);
}

// The set of batches this browser is watching, persisted so a reload keeps the
// progress drawer populated (the server remains the source of truth for state).
const STORAGE_KEY = "hearted-control-panel.tracked-batches.v1";
const listeners = new Set<() => void>();

function readTracked(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
		return Array.isArray(stored)
			? stored.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

function writeTracked(ids: string[]): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
	} catch {
		return;
	}
	for (const listener of listeners) listener();
}

export const batchTracker = {
	get(): string[] {
		return readTracked();
	},
	track(id: string): void {
		const ids = readTracked();
		// Only a genuine addition notifies subscribers; re-tracking an id already in
		// the set is a no-op, so a refresh that re-tracks active batches can't loop.
		if (!ids.includes(id)) writeTracked([...ids, id]);
	},
	untrack(id: string): void {
		writeTracked(readTracked().filter((existing) => existing !== id));
	},
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};
