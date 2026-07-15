/**
 * Local-store lifecycle. Opens the SQLite file, applies migrations, and reclaims
 * interrupted runs on startup. Kept as module singleton state because the panel
 * is a single local process; the mutation wrapper reads readiness synchronously.
 *
 * If initialization fails, reads still work but every mutating endpoint must
 * refuse: a prod write may never run while its local run record cannot be
 * created. `isLocalStoreReady()` gates that; `record.ts` throws 503 when false.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { markStaleStartedInterrupted } from "./action-runs";
import { markStaleBatchesInterrupted } from "./batches";
import { applyMigrations } from "./migrations";
import { openSqlite, type SqliteDriver } from "./sqlite";

let driver: SqliteDriver | null = null;
let ready = false;
let initError: Error | null = null;

export function localStorePath(): string {
	const dir =
		process.env.CP_DATA_DIR ?? join(process.cwd(), "control-panel", ".data");
	return join(dir, "control-panel.sqlite");
}

export async function initLocalStore(
	path: string = localStorePath(),
): Promise<void> {
	try {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		const db = await openSqlite(path);
		applyMigrations(db);
		markStaleStartedInterrupted(db, new Date().toISOString());
		markStaleBatchesInterrupted(db);
		driver = db;
		ready = true;
		initError = null;
	} catch (error) {
		ready = false;
		driver = null;
		initError = error instanceof Error ? error : new Error(String(error));
		console.error(
			"[control-panel] local action history failed to initialize; mutating endpoints will refuse to run:",
			initError.message,
		);
	}
}

export function isLocalStoreReady(): boolean {
	return ready;
}

export function localStoreError(): Error | null {
	return initError;
}

export function getLocalStore(): SqliteDriver {
	if (!driver || !ready) {
		throw new Error("Local action history is not available.");
	}
	return driver;
}

/** Test-only: dispose the singleton so a fresh temp file can be initialized. */
export function resetLocalStoreForTests(): void {
	driver?.close();
	driver = null;
	ready = false;
	initError = null;
}
