import type { ErrorEvent, EventHint } from "@sentry/core";

/** PG SQLSTATE for "canceling statement due to statement timeout". */
const STATEMENT_TIMEOUT_PG_CODE = "57014";

/**
 * Single fingerprint shared by every statement-timeout event. Omitting the
 * `{{ default }}` placeholder overwrites Sentry's stacktrace-based grouping
 * entirely, so timeouts from any operation collapse into one issue.
 */
const STATEMENT_TIMEOUT_FINGERPRINT = ["db-statement-timeout"];

/**
 * `beforeSend` hook for the two server-side Sentry runtimes (Cloudflare web
 * server + Bun worker). The browser never sees DB errors, so it does not use
 * this.
 *
 * A statement timeout is an infra-capacity signal, not N distinct bugs: every
 * slow query that trips the `statement_timeout` ceiling reports a different
 * stacktrace/operation, so Sentry's default grouping fans them out into dozens
 * of separate issues that are impossible to alert on as one thing. This
 * collapses them all into a single `db-statement-timeout` issue while leaving
 * every other event on Sentry's default grouping.
 */
export function applyServerErrorFingerprint(
	event: ErrorEvent,
	hint: EventHint,
): ErrorEvent {
	if (isStatementTimeout(event, hint)) {
		event.fingerprint = STATEMENT_TIMEOUT_FINGERPRINT;
	}
	return event;
}

function isStatementTimeout(event: ErrorEvent, hint: EventHint): boolean {
	// `captureServerError` promotes the PG code to a tag, the cheapest signal.
	if (event.tags?.db_code === STATEMENT_TIMEOUT_PG_CODE) {
		return true;
	}

	// Fall back to the raw error in case a timeout is captured by some other
	// path (a bare throw, a worker loop) that never set the tag.
	const error = hint.originalException;
	if (error !== null && typeof error === "object") {
		if (
			"code" in error &&
			(error as { code?: unknown }).code === STATEMENT_TIMEOUT_PG_CODE
		) {
			return true;
		}
		if (
			"message" in error &&
			typeof (error as { message?: unknown }).message === "string" &&
			/canceling statement due to statement timeout/i.test(
				(error as { message: string }).message,
			)
		) {
			return true;
		}
	}

	return false;
}
