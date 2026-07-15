import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageSize } from "./types";

export type QueueMode = "focus" | "list";
export type QueueOrder = "oldest" | "newest";

// Focus mode is the operator default: one card at a time for high-throughput
// draining. The choice is a durable per-queue preference, not investigation
// state, so it lives in localStorage rather than the URL.
const MODE_PREFIX = "hearted-control-panel.review-preferences.v1";

function readMode(storageKey: string): QueueMode {
	if (typeof window === "undefined") return "focus";
	try {
		const stored = window.localStorage.getItem(
			`${MODE_PREFIX}.${storageKey}.mode`,
		);
		return stored === "list" ? "list" : "focus";
	} catch {
		return "focus";
	}
}

function parsePageSize(value: string | null): PageSize {
	if (value === "25") return 25;
	if (value === "100") return 100;
	return 50;
}

function enumValue<T extends string>(
	value: string | null,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.find((candidate) => candidate === value) ?? fallback;
}

export interface QueueConfig<Tab extends string, FilterKey extends string> {
	// Namespaces the localStorage mode preference so each queue remembers its own.
	storageKey: string;
	tabs: readonly Tab[];
	defaultTab: Tab;
	// Extra section-specific URL filter params (e.g. audio's sourceType). Each maps
	// to a default value used when absent or when Reset runs.
	filterKeys?: readonly FilterKey[];
	filterDefaults?: Record<FilterKey, string>;
	defaultOrder?: QueueOrder;
}

export interface QueueState<Tab extends string, FilterKey extends string> {
	tab: Tab;
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
	mode: QueueMode;
	filters: Record<FilterKey, string>;
	focusIndex: number;
	setTab: (tab: Tab) => void;
	setSearch: (value: string) => void;
	setOrder: (order: QueueOrder) => void;
	setPage: (page: number) => void;
	setPageSize: (pageSize: PageSize) => void;
	setMode: (mode: QueueMode) => void;
	setFilter: (key: FilterKey, value: string) => void;
	setFocusIndex: (index: number) => void;
	reset: () => void;
	// Shared list params for the fetch URL. The section appends the tab under
	// whatever name its endpoint expects (filter/status), so this stays generic.
	listParams: URLSearchParams;
}

interface UrlState<Tab extends string, FilterKey extends string> {
	tab: Tab;
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
	filters: Record<FilterKey, string>;
}

export function useQueueState<
	Tab extends string,
	FilterKey extends string = never,
>(config: QueueConfig<Tab, FilterKey>): QueueState<Tab, FilterKey> {
	const {
		storageKey,
		tabs,
		defaultTab,
		filterKeys,
		filterDefaults,
		defaultOrder = "oldest",
	} = config;

	const readUrl = useCallback((): UrlState<Tab, FilterKey> => {
		const params = new URL(window.location.href).searchParams;
		const page = Number(params.get("page"));
		const filters = {} as Record<FilterKey, string>;
		for (const key of filterKeys ?? []) {
			filters[key] = params.get(key) ?? filterDefaults?.[key] ?? "all";
		}
		return {
			tab: enumValue(params.get("view"), tabs, defaultTab),
			q: params.get("q") ?? "",
			order: enumValue(params.get("order"), ["oldest", "newest"], defaultOrder),
			page: Number.isInteger(page) && page > 0 ? page : 1,
			pageSize: parsePageSize(params.get("pageSize")),
			filters,
		};
	}, [tabs, defaultTab, filterKeys, filterDefaults, defaultOrder]);

	const [url, setUrl] = useState<UrlState<Tab, FilterKey>>(readUrl);
	const [mode, setModeState] = useState<QueueMode>(() => readMode(storageKey));
	// Card position within the full result set for focus mode. Reset whenever the
	// matching set changes (tab/search/order/filter), never on paging.
	const [focusIndex, setFocusIndex] = useState(0);

	// Setters read the latest state through a ref so they stay referentially
	// stable — sections use them in effect dependency lists, and re-creating them
	// each render would re-run those effects on every render.
	const stateRef = useRef(url);
	stateRef.current = url;
	const configRef = useRef({
		defaultTab,
		defaultOrder,
		filterKeys,
		filterDefaults,
	});
	configRef.current = { defaultTab, defaultOrder, filterKeys, filterDefaults };

	useEffect(() => {
		const onPopState = () => {
			setUrl(readUrl());
			setFocusIndex(0);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [readUrl]);

	const pushUrl = useCallback((next: UrlState<Tab, FilterKey>) => {
		const cfg = configRef.current;
		setUrl(next);
		const target = new URL(window.location.href);
		if (next.tab === cfg.defaultTab) target.searchParams.delete("view");
		else target.searchParams.set("view", next.tab);
		if (next.q) target.searchParams.set("q", next.q);
		else target.searchParams.delete("q");
		if (next.order === cfg.defaultOrder) target.searchParams.delete("order");
		else target.searchParams.set("order", next.order);
		target.searchParams.set("page", String(next.page));
		target.searchParams.set("pageSize", String(next.pageSize));
		for (const key of cfg.filterKeys ?? []) {
			const value = next.filters[key];
			const fallback = cfg.filterDefaults?.[key] ?? "all";
			if (value && value !== fallback) target.searchParams.set(key, value);
			else target.searchParams.delete(key);
		}
		window.history.pushState({ controlPanel: true }, "", target);
	}, []);

	const setTab = useCallback(
		(tab: Tab) => {
			setFocusIndex(0);
			pushUrl({ ...stateRef.current, tab, page: 1 });
		},
		[pushUrl],
	);
	const setSearch = useCallback(
		(q: string) => {
			setFocusIndex(0);
			pushUrl({ ...stateRef.current, q, page: 1 });
		},
		[pushUrl],
	);
	const setOrder = useCallback(
		(order: QueueOrder) => {
			setFocusIndex(0);
			pushUrl({ ...stateRef.current, order, page: 1 });
		},
		[pushUrl],
	);
	const setPage = useCallback(
		(page: number) => pushUrl({ ...stateRef.current, page: Math.max(1, page) }),
		[pushUrl],
	);
	const setPageSize = useCallback(
		(pageSize: PageSize) => {
			setFocusIndex(0);
			pushUrl({ ...stateRef.current, pageSize, page: 1 });
		},
		[pushUrl],
	);
	const setFilter = useCallback(
		(key: FilterKey, value: string) => {
			setFocusIndex(0);
			pushUrl({
				...stateRef.current,
				filters: { ...stateRef.current.filters, [key]: value },
				page: 1,
			});
		},
		[pushUrl],
	);
	const setMode = useCallback(
		(next: QueueMode) => {
			setModeState(next);
			try {
				window.localStorage.setItem(`${MODE_PREFIX}.${storageKey}.mode`, next);
			} catch {
				// A private-mode localStorage failure shouldn't break the toggle.
			}
		},
		[storageKey],
	);
	const reset = useCallback(() => {
		setFocusIndex(0);
		const cfg = configRef.current;
		const filters = {} as Record<FilterKey, string>;
		for (const key of cfg.filterKeys ?? []) {
			filters[key] = cfg.filterDefaults?.[key] ?? "all";
		}
		pushUrl({
			tab: cfg.defaultTab,
			q: "",
			order: cfg.defaultOrder,
			page: 1,
			pageSize: 50,
			filters,
		});
	}, [pushUrl]);

	const listParams = useMemo(() => {
		const params = new URLSearchParams();
		params.set("q", url.q);
		params.set("order", url.order);
		params.set("page", String(url.page));
		params.set("pageSize", String(url.pageSize));
		for (const key of filterKeys ?? []) {
			params.set(key, url.filters[key]);
		}
		return params;
	}, [url, filterKeys]);

	return {
		tab: url.tab,
		q: url.q,
		order: url.order,
		page: url.page,
		pageSize: url.pageSize,
		mode,
		filters: url.filters,
		focusIndex,
		setTab,
		setSearch,
		setOrder,
		setPage,
		setPageSize,
		setMode,
		setFilter,
		setFocusIndex,
		reset,
		listParams,
	};
}
