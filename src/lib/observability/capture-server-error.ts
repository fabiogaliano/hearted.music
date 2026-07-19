import * as Sentry from "@sentry/cloudflare";

/**
 * Server-side error capture for server functions and domain code running in the
 * Cloudflare web server.
 *
 * The web server runs with `enableLogs: false` (see `server.ts`), so `console.*`
 * never reaches Sentry — only an explicit `captureException` or an uncaught
 * throw does. Server functions routinely translate a typed `Result` error into a
 * friendly thrown string (to hide DB internals from the client) or swallow it
 * into a fallback value; both drop the underlying cause, leaving us blind when
 * the path fails in production. Call this at those boundaries so the real error
 * — its `_tag` and any PostgREST/PG `code` — is recorded before it is hidden.
 *
 * Accepts `unknown` so it serves both typed `DbError`/`TaggedError` values and
 * raw caught exceptions. A `TaggedError`'s `_tag` and a `DatabaseError`'s `code`
 * are promoted to searchable Sentry tags; the account becomes `user.id`.
 */
function readErrorTags(value: unknown): {
	db_error?: string;
	db_code?: string;
} {
	if (value === null || typeof value !== "object") return {};
	const tags: { db_error?: string; db_code?: string } = {};
	if ("_tag" in value && typeof value._tag === "string") {
		tags.db_error = value._tag;
	}
	if ("code" in value && typeof value.code === "string") {
		tags.db_code = value.code;
	}
	return tags;
}

function readCause(value: unknown): unknown {
	if (value === null || typeof value !== "object") return undefined;
	return "cause" in value ? value.cause : undefined;
}

export function captureServerError(
	error: unknown,
	context: {
		/** Stable identifier for the failing operation, e.g. "get_billing_state". */
		operation: string;
		/** Coarse grouping for dashboards/alerts, e.g. "billing", "playlists". */
		area?: string;
		/** Account the failure belongs to, attached as Sentry `user.id`. */
		accountId?: string;
		/** Extra structured context (ids, counts) to aid diagnosis. */
		extra?: Record<string, unknown>;
	},
): void {
	const tags: Record<string, string> = { operation: context.operation };
	if (context.area) tags.area = context.area;

	// Domain code often returns the error wrapped — UnlockError is
	// `{ kind: "db_error", cause: DatabaseError }` — so `_tag`/`code` sit one
	// level down. Reading only the top level left every wrapped failure with no
	// db_* tags at all, which is why a production lock timeout arrived with no
	// SQLSTATE to group or alert on. Own fields win over the cause's.
	const own = readErrorTags(error);
	const nested = readErrorTags(readCause(error));
	const dbError = own.db_error ?? nested.db_error;
	const dbCode = own.db_code ?? nested.db_code;
	if (dbError) tags.db_error = dbError;
	if (dbCode) tags.db_code = dbCode;

	Sentry.captureException(error, {
		tags,
		...(context.accountId ? { user: { id: context.accountId } } : {}),
		...(context.extra ? { extra: context.extra } : {}),
	});
}
