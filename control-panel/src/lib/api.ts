import { useCallback, useEffect, useState } from "react";

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

export function useApi<T>(path: string, refreshKey = 0): QueryState<T> {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	const refetch = useCallback(() => setTick((t) => t + 1), []);

	// tick (internal refetch) and refreshKey (global refresh) are deliberate
	// re-run triggers, not values read in the body — biome's autofix would drop them.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional refetch triggers
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		getJson<T>(path)
			.then((d) => {
				if (!cancelled) setData(d);
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
