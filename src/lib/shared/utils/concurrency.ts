/**
 * Semaphore-based concurrency limiter for rate-limiting parallel operations.
 * Allows N concurrent operations, with slots freed as they complete (no head-of-line blocking).
 *
 * Usage:
 *   const limiter = new ConcurrencyLimiter(5, 50)
 *   const results = await Promise.all(items.map(item =>
 *     limiter.run(() => fetchData(item))
 *   ))
 */
export class ConcurrencyLimiter {
	private running = 0;
	private lastStartTime = 0;
	private startChain: Promise<void> = Promise.resolve();
	private readonly queue: Array<() => void> = [];

	/**
	 * @param limit Maximum number of concurrent operations
	 * @param minIntervalMs Minimum time between starting new operations (optional)
	 * @param maxIntervalMs Optional max interval for jitter (defaults to minIntervalMs)
	 */
	constructor(
		private readonly limit: number,
		private readonly minIntervalMs: number = 0,
		private readonly maxIntervalMs: number = minIntervalMs,
	) {
		if (limit < 1) {
			throw new Error("ConcurrencyLimiter limit must be at least 1");
		}
		if (this.maxIntervalMs < this.minIntervalMs) {
			throw new Error(
				"ConcurrencyLimiter maxIntervalMs must be >= minIntervalMs",
			);
		}
	}

	/**
	 * Acquire a slot. Resolves when a slot is available.
	 */
	async acquire(): Promise<void> {
		if (this.running < this.limit) {
			this.running++;
			await this.waitForStartSlot();
			return;
		}

		// Wait in queue for a slot (slot is transferred atomically in release())
		await new Promise<void>((resolve) => this.queue.push(resolve));
		await this.waitForStartSlot();
	}

	/**
	 * Release a slot, allowing the next queued operation to proceed.
	 */
	release(): void {
		const next = this.queue.shift();
		if (next) {
			// Transfer slot directly to next waiter (running count unchanged)
			next();
		} else {
			// No waiters, free the slot
			this.running--;
		}
	}

	/**
	 * Run an async function with concurrency limiting.
	 * Automatically acquires and releases a slot.
	 */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	/**
	 * Current number of running operations.
	 */
	get activeCount(): number {
		return this.running;
	}

	/**
	 * Number of operations waiting in the queue.
	 */
	get pendingCount(): number {
		return this.queue.length;
	}

	private async waitForStartSlot(): Promise<void> {
		if (this.minIntervalMs <= 0) {
			return;
		}

		this.startChain = this.startChain.then(async () => {
			const intervalMs = this.getIntervalMs();
			const now = Date.now();
			const waitMs = Math.max(0, this.lastStartTime + intervalMs - now);
			if (waitMs > 0) {
				await this.delay(waitMs);
			}
			this.lastStartTime = Date.now();
		});

		await this.startChain;
	}

	private getIntervalMs(): number {
		if (this.maxIntervalMs <= this.minIntervalMs) {
			return this.minIntervalMs;
		}
		const range = this.maxIntervalMs - this.minIntervalMs;
		return this.minIntervalMs + Math.floor(Math.random() * (range + 1));
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
