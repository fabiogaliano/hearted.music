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
	if (error !== null && typeof error === "object") {
		if ("_tag" in error && typeof error._tag === "string") {
			tags.db_error = error._tag;
		}
		if ("code" in error && typeof error.code === "string") {
			tags.db_code = error.code;
		}
	}

	Sentry.captureException(error, {
		tags,
		...(context.accountId ? { user: { id: context.accountId } } : {}),
		...(context.extra ? { extra: context.extra } : {}),
	});
}
