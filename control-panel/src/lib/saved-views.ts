import { SECTION_KEYS, type SectionKey } from "./url-state";

const STORAGE_KEY = "hearted-control-panel.saved-views.v1";
const MAX_VIEWS = 30;

export interface SavedView {
	id: string;
	label: string;
	section: SectionKey;
	// Normalized query string, without the leading "?" and without "section"
	// (the section is stored separately since it picks the destination).
	params: string;
	createdAt: string;
}

const sectionSet = new Set<string>(SECTION_KEYS);

function isSavedView(value: unknown): value is SavedView {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.id === "string" &&
		typeof v.label === "string" &&
		v.label.trim().length > 0 &&
		typeof v.section === "string" &&
		sectionSet.has(v.section) &&
		typeof v.params === "string" &&
		typeof v.createdAt === "string"
	);
}

function readAll(): SavedView[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
	} catch {
		return [];
	}
}

function writeAll(views: readonly SavedView[]): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

export function listSavedViews(): SavedView[] {
	return readAll().sort((a, b) => a.label.localeCompare(b.label));
}

export function findSavedViewByName(label: string): SavedView | null {
	const normalized = label.trim().toLowerCase();
	if (!normalized) return null;
	return readAll().find((v) => v.label.toLowerCase() === normalized) ?? null;
}

export function saveView(
	label: string,
	section: SectionKey,
	params: string,
): SavedView {
	const trimmed = label.trim();
	if (!trimmed) throw new Error("Name must not be empty.");
	const views = readAll();
	const existing = views.find(
		(v) => v.label.toLowerCase() === trimmed.toLowerCase(),
	);
	const existingIndex = existing ? views.indexOf(existing) : -1;
	const view: SavedView = {
		id: existing ? existing.id : crypto.randomUUID(),
		label: trimmed,
		section,
		params,
		createdAt: new Date().toISOString(),
	};
	if (existingIndex >= 0) {
		const next = [...views];
		next[existingIndex] = view;
		writeAll(next);
		return view;
	}
	if (views.length >= MAX_VIEWS) {
		throw new Error(
			`Saved views are limited to ${MAX_VIEWS}; delete one before saving another.`,
		);
	}
	writeAll([...views, view]);
	return view;
}

export function deleteSavedView(id: string): void {
	writeAll(readAll().filter((v) => v.id !== id));
}
