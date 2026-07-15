/**
 * Minimal synchronous SQLite driver for the control panel's local action history.
 *
 * The panel's API runs under Bun (`bun run cp:api`), so production uses the
 * built-in `bun:sqlite`. Vitest, however, runs under Node (`bun run test` shells
 * out to the node-shebanged vitest binary), where `bun:sqlite` does not resolve.
 * Node ships its own built-in `node:sqlite`, so we detect the runtime and adapt
 * whichever driver is present to one narrow surface. Both are zero-dependency
 * built-ins, honoring the plan's "no new package" constraint while keeping the
 * migrations and repository genuinely testable against a real temp file.
 *
 * Only positional `?` placeholders are used so the same SQL binds identically
 * under both drivers. Bind values are limited to string | number | null; SQLite
 * has no boolean, and node:sqlite rejects booleans outright, so callers coerce.
 */

export type SqliteValue = string | number | null;

export interface SqliteRunResult {
	changes: number;
}

export interface SqliteDriver {
	/** Run one or more statements with no bound params and no result. */
	exec(sql: string): void;
	/** Run a single statement; returns the affected row count. */
	run(sql: string, params?: readonly SqliteValue[]): SqliteRunResult;
	/** Fetch the first row of a query, or undefined when empty. */
	get<T>(sql: string, params?: readonly SqliteValue[]): T | undefined;
	/** Fetch every row of a query. */
	all<T>(sql: string, params?: readonly SqliteValue[]): T[];
	close(): void;
}

// Structural shapes of the two built-in drivers, limited to the methods used.
interface DriverStatement {
	all(...params: SqliteValue[]): unknown[];
	get(...params: SqliteValue[]): unknown;
	run(...params: SqliteValue[]): { changes: number | bigint };
}

interface BunDatabase {
	query(sql: string): DriverStatement;
	exec(sql: string): void;
	close(): void;
}

interface NodeDatabase {
	prepare(sql: string): DriverStatement;
	exec(sql: string): void;
	close(): void;
}

function adaptStatement(
	prepare: (sql: string) => DriverStatement,
): Pick<SqliteDriver, "run" | "get" | "all"> {
	return {
		run(sql, params = []) {
			const result = prepare(sql).run(...params);
			return { changes: Number(result.changes) };
		},
		get<T>(sql: string, params: readonly SqliteValue[] = []) {
			return prepare(sql).get(...params) as T | undefined;
		},
		all<T>(sql: string, params: readonly SqliteValue[] = []) {
			return prepare(sql).all(...params) as T[];
		},
	};
}

export async function openSqlite(path: string): Promise<SqliteDriver> {
	if (typeof Bun !== "undefined") {
		// A variable specifier keeps Vite/Vitest from trying to resolve bun:sqlite
		// when this module is imported under Node, where the branch never runs.
		const specifier = "bun:sqlite";
		const mod = (await import(/* @vite-ignore */ specifier)) as {
			Database: new (filename: string) => BunDatabase;
		};
		const db = new mod.Database(path);
		const statements = adaptStatement((sql) => db.query(sql));
		return {
			exec: (sql) => db.exec(sql),
			close: () => db.close(),
			...statements,
		};
	}

	const specifier = "node:sqlite";
	const mod = (await import(/* @vite-ignore */ specifier)) as {
		DatabaseSync: new (filename: string) => NodeDatabase;
	};
	const db = new mod.DatabaseSync(path);
	const statements = adaptStatement((sql) => db.prepare(sql));
	return {
		exec: (sql) => db.exec(sql),
		close: () => db.close(),
		...statements,
	};
}
