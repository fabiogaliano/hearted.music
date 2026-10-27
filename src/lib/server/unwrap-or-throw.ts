import { Result, TaggedError } from "better-result";
import { captureServerError } from "@/lib/observability/capture-server-error";

interface ServerFnFailureContext {
	area: string;
	operation: string;
	accountId: string;
}

/**
 * The message names only the operation: the cause stays on the server (Sentry)
 * so table, constraint and SQLSTATE details never reach the browser.
 */
export class ServerFnError extends TaggedError("ServerFnError")<{
	area: string;
	operation: string;
	message: string;
	cause: unknown;
}> {}

/**
 * Server-fn boundary for a domain `Result`: a failure is reported and thrown,
 * so the client's query lands in its error state instead of resolving to a
 * success-shaped empty value that reads as "no data".
 */
export function unwrapOrThrow<T, E>(
	result: Result<T, E>,
	context: ServerFnFailureContext,
): T {
	if (Result.isOk(result)) return result.value;

	captureServerError(result.error, context);
	throw new ServerFnError({
		area: context.area,
		operation: context.operation,
		message: `${context.operation} failed`,
		cause: result.error,
	});
}
