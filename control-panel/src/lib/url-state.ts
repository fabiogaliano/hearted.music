import { useCallback, useEffect, useState } from "react";

export const SECTION_KEYS = [
	"overview",
	"users",
	"library",
	"enrichment",
	"jobs",
	"billing",
	"operations",
	"audio-review",
	"release-year",
	"lyrics-review",
	"instrumental-review",
	"email",
	"history",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export interface PanelUrlState {
	section: SectionKey;
	userId: string | null;
	tierMin: number | null;
	tierMax: number | null;
	view: string | null;
}

const sectionSet = new Set<string>(SECTION_KEYS);

function isSectionKey(value: string | null): value is SectionKey {
	return value !== null && sectionSet.has(value);
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInteger(value: string | null): number | null {
	if (value === null || !/^-?\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseTier(value: string | null): number | null {
	const parsed = parseInteger(value);
	return parsed !== null && parsed >= 0 ? parsed : null;
}

export function parseUrlState(url: URL): PanelUrlState {
	const requestedSection = url.searchParams.get("section");
	const section: SectionKey = isSectionKey(requestedSection)
		? requestedSection
		: "overview";
	const user = url.searchParams.get("user");
	const tierMin = parseTier(url.searchParams.get("tierMin"));
	const tierMax = parseTier(url.searchParams.get("tierMax"));

	return {
		section,
		userId: user && uuidPattern.test(user) ? user : null,
		tierMin,
		tierMax:
			tierMin !== null && tierMax !== null && tierMax >= tierMin
				? tierMax
				: null,
		view: url.searchParams.get("view") || null,
	};
}

export function canonicalUrl(url: URL): URL {
	const next = new URL(url);
	const state = parseUrlState(next);
	next.searchParams.set("section", state.section);
	if (state.userId) next.searchParams.set("user", state.userId);
	else next.searchParams.delete("user");
	if (state.tierMin !== null)
		next.searchParams.set("tierMin", String(state.tierMin));
	else next.searchParams.delete("tierMin");
	if (state.tierMax !== null)
		next.searchParams.set("tierMax", String(state.tierMax));
	else next.searchParams.delete("tierMax");
	if (state.view) next.searchParams.set("view", state.view);
	else next.searchParams.delete("view");
	return next;
}

export function sameUrl(a: URL, b: URL): boolean {
	return (
		a.pathname === b.pathname && a.search === b.search && a.hash === b.hash
	);
}

function allowedView<T extends string>(
	value: string | null,
	values: readonly T[],
): T | null {
	return values.find((candidate) => candidate === value) ?? null;
}

export function useUrlView<T extends string>(
	values: readonly T[],
	fallback: T,
): readonly [T, (value: T) => void] {
	const read = useCallback(
		() =>
			allowedView(
				new URL(window.location.href).searchParams.get("view"),
				values,
			) ?? fallback,
		[values, fallback],
	);
	const [view, setView] = useState(read);

	useEffect(() => {
		const current = new URL(window.location.href);
		const rawView = current.searchParams.get("view");
		if (rawView !== null && allowedView(rawView, values) === null) {
			current.searchParams.delete("view");
			window.history.replaceState({ controlPanel: true }, "", current);
		}
		const onPopState = () => setView(read());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [read, values]);

	function updateView(nextView: T) {
		const next = new URL(window.location.href);
		next.searchParams.set("view", nextView);
		window.history.pushState({ controlPanel: true }, "", next);
		setView(nextView);
	}

	return [view, updateView] as const;
}
