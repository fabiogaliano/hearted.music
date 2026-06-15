import { useCallback, useEffect, useRef, useState } from "react";

// Vite proxies /api to the Bun server, so requests are same-origin in dev.
export async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(path);
	const body = await res.json();
	if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
	return body as T;
}

export async function postJson<T>(path: string, data: unknown): Promise<T> {
	const res = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const body = await res.json();
	if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
	return body as T;
}

export interface QueryState<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	refetch: () => void;
}

// Sections remount on navigation (App keys them), so component state can't carry
// a result across visits. This module-level cache does: a revisit seeds instantly
// from the last response while a background refetch keeps it current. The server
// has its own short TTL cache, so that background refetch is usually a fast hit.
const responseCache = new Map<string, unknown>();

// Highest refreshKey for which we've already fetched fresh data for a path. Lets a
// global refresh (which remounts the section, wiping component refs) still force a
// single bypass per path, instead of silently serving the client/server cache.
const freshWatermark = new Map<string, number>();

function withFresh(path: string): string {
	return `${path}${path.includes("?") ? "&" : "?"}fresh=1`;
}

export function useApi<T>(path: string, refreshKey = 0): QueryState<T> {
	const seed = responseCache.get(path) as T | undefined;
	const [data, setData] = useState<T | null>(seed ?? null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(seed === undefined);
	const [tick, setTick] = useState(0);
	const lastTick = useRef(0);

	const refetch = useCallback(() => setTick((t) => t + 1), []);

	// tick (internal refetch) and refreshKey (global refresh) are deliberate
	// re-run triggers, read in the body to decide whether to force a fresh fetch.
	useEffect(() => {
		let cancelled = false;

		const tickForced = tick !== lastTick.current;
		lastTick.current = tick;
		const keyForced = refreshKey > (freshWatermark.get(path) ?? 0);
		if (keyForced) freshWatermark.set(path, refreshKey);
		const forced = tickForced || keyForced;

		const cachedData = responseCache.get(path) as T | undefined;
		if (cachedData !== undefined && !forced) {
			// Revisit with a warm cache: show it now, refresh quietly underneath.
			setData(cachedData);
			setError(null);
			setLoading(false);
		} else if (cachedData === undefined) {
			setLoading(true);
			setError(null);
		}

		getJson<T>(forced ? withFresh(path) : path)
			.then((d) => {
				if (cancelled) return;
				responseCache.set(path, d);
				setData(d);
				setError(null);
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [path, tick, refreshKey]);

	return { data, error, loading, refetch };
}
