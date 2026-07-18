const STORAGE_KEY = "hearted-control-panel.attention-thresholds.v1";

// Every rule keeps a numeric floor rather than a plain "any" boolean: the
// ones the plan calls "any" simply default to a floor of 1 (any positive
// count), and the operator can raise the bar from the settings popover the
// same way they'd raise the two age-based thresholds.
export interface AttentionThresholds {
	failedJobsMin: number;
	staleRunningMin: number;
	actionableFailuresMin: number;
	pendingJobsMinAgeMinutes: number;
	pendingGrantsMin: number;
	noLibraryMinAgeHours: number;
}

export const DEFAULT_ATTENTION_THRESHOLDS: AttentionThresholds = {
	failedJobsMin: 1,
	staleRunningMin: 1,
	actionableFailuresMin: 1,
	pendingJobsMinAgeMinutes: 10,
	pendingGrantsMin: 1,
	noLibraryMinAgeHours: 24,
};

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitize(value: unknown): AttentionThresholds {
	if (typeof value !== "object" || value === null) {
		return DEFAULT_ATTENTION_THRESHOLDS;
	}
	const record = value as Record<string, unknown>;
	const next = { ...DEFAULT_ATTENTION_THRESHOLDS };
	for (const key of Object.keys(
		DEFAULT_ATTENTION_THRESHOLDS,
	) as (keyof AttentionThresholds)[]) {
		if (isFiniteNonNegative(record[key])) next[key] = record[key] as number;
	}
	return next;
}

export function readAttentionThresholds(): AttentionThresholds {
	if (typeof window === "undefined") return DEFAULT_ATTENTION_THRESHOLDS;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_ATTENTION_THRESHOLDS;
		return sanitize(JSON.parse(raw));
	} catch {
		return DEFAULT_ATTENTION_THRESHOLDS;
	}
}

export function writeAttentionThresholds(next: AttentionThresholds): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(next)));
	} catch {
		// Best-effort: a full/blocked localStorage just means the next read falls
		// back to defaults, same as if nothing had ever been saved.
	}
}
