/**
 * Tiny in-process TTL cache for read endpoints.
 *
 * The panel reads prod through Supabase's small free-tier compute, so the win is
 * not running the same aggregate twice. Two layers:
 *   • a TTL store, so a value is reused for `ttl` ms after it's computed;
 *   • in-flight de-duplication, so N concurrent callers (the Overview fires five
 *     endpoints at once) collapse onto a single query instead of stampeding the
 *     pooler.
 *
 * `fresh` skips the store (the UI's "Refresh" button) but still de-dupes and
 * repopulates, so a forced refresh never fans out into duplicate queries either.
 */

const DEFAULT_TTL = 30_000;

interface Entry {
	value: unknown;
	expires: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
	key: string,
	fn: () => Promise<T>,
	fresh = false,
	ttl = DEFAULT_TTL,
): Promise<T> {
	const now = Date.now();

	if (!fresh) {
		const hit = store.get(key);
		if (hit && hit.expires > now) return hit.value as T;
		const pending = inflight.get(key);
		if (pending) return pending as Promise<T>;
	}

	const promise = (async () => {
		try {
			const value = await fn();
			store.set(key, { value, expires: Date.now() + ttl });
			return value;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, promise);
	return promise;
}
