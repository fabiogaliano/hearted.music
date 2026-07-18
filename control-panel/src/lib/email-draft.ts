const STORAGE_KEY = "hearted-control-panel.email-draft.v1";
const HISTORY_DRAFTS_KEY = "hearted-control-panel.email-history-drafts.v1";
const MAX_HISTORY_DRAFTS = 30;

export interface EmailDraft {
	subject: string;
	headline: string;
	body: string;
	ctaLabel: string;
	ctaUrl: string;
	preheader: string;
	footnote: string;
}

export interface StoredEmailDraft {
	draft: EmailDraft;
	templateId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmailDraft(value: unknown): value is EmailDraft {
	if (!isRecord(value)) return false;
	const draft = value;
	return [
		"subject",
		"headline",
		"body",
		"ctaLabel",
		"ctaUrl",
		"preheader",
		"footnote",
	].every((key) => typeof draft[key] === "string");
}

function isStoredEmailDraft(value: unknown): value is StoredEmailDraft {
	if (!isRecord(value)) return false;
	const stored = value;
	return (
		isEmailDraft(stored.draft) &&
		(stored.templateId === null || typeof stored.templateId === "string")
	);
}

function read(key: string): unknown {
	if (typeof window === "undefined") return null;
	try {
		return JSON.parse(window.localStorage.getItem(key) ?? "null");
	} catch {
		return null;
	}
}

export function readEmailDraft(): StoredEmailDraft | null {
	const value = read(STORAGE_KEY);
	return isStoredEmailDraft(value) ? value : null;
}

export function writeEmailDraft(value: StoredEmailDraft): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		return;
	}
}

export function isDraftEmpty(draft: EmailDraft): boolean {
	return Object.values(draft).every((value) => value.length === 0);
}

interface HistoryDraft extends StoredEmailDraft {
	runId: string;
}

function isHistoryDraft(value: unknown): value is HistoryDraft {
	if (!isRecord(value)) return false;
	const entry = value;
	return typeof entry.runId === "string" && isStoredEmailDraft(entry);
}

function readHistoryDrafts(): HistoryDraft[] {
	const value = read(HISTORY_DRAFTS_KEY);
	return Array.isArray(value) ? value.filter(isHistoryDraft) : [];
}

// Local action history intentionally stores only an email body's hash and length.
// This browser-only cache makes duplication useful without weakening that boundary.
export function rememberEmailHistoryDraft(
	runId: string,
	value: StoredEmailDraft,
): void {
	if (typeof window === "undefined") return;
	try {
		const next = [
			{ runId, ...value },
			...readHistoryDrafts().filter((entry) => entry.runId !== runId),
		].slice(0, MAX_HISTORY_DRAFTS);
		window.localStorage.setItem(HISTORY_DRAFTS_KEY, JSON.stringify(next));
	} catch {
		return;
	}
}

export function readEmailHistoryDraft(runId: string): StoredEmailDraft | null {
	const entry = readHistoryDrafts().find(
		(candidate) => candidate.runId === runId,
	);
	return entry ? { draft: entry.draft, templateId: entry.templateId } : null;
}
