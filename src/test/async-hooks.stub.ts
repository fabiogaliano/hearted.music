// Browser shim for node:async_hooks, aliased in via ladle-vite.config.ts.
//
// TanStack Start's start-storage-context constructs `new AsyncLocalStorage()`
// at module load to hold per-request context. The app build strips that
// server module via the Start Vite plugin, but Ladle doesn't run it, so the
// module reaches the browser where Vite externalizes node:async_hooks to a
// stub whose AsyncLocalStorage isn't constructable. This keeps construction
// working with a synchronous store; server-fn handlers are RPC callers that
// never run in Ladle, so run/getStore are never meaningfully exercised.
export class AsyncLocalStorage<T> {
	#store: T | undefined;

	run<R, A extends unknown[]>(store: T, fn: (...args: A) => R, ...args: A): R {
		const previous = this.#store;
		this.#store = store;
		try {
			return fn(...args);
		} finally {
			this.#store = previous;
		}
	}

	getStore(): T | undefined {
		return this.#store;
	}

	enterWith(store: T): void {
		this.#store = store;
	}

	exit<R, A extends unknown[]>(fn: (...args: A) => R, ...args: A): R {
		const previous = this.#store;
		this.#store = undefined;
		try {
			return fn(...args);
		} finally {
			this.#store = previous;
		}
	}

	disable(): void {
		this.#store = undefined;
	}
}

export class AsyncResource {}

export function executionAsyncId(): number {
	return 0;
}

export default { AsyncLocalStorage, AsyncResource, executionAsyncId };
