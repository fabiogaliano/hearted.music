import { captureServerError } from "@/lib/observability/capture-server-error";
import { log } from "@/lib/observability/logger";
import { POSTGREST_MAX_ROWS } from "@/lib/shared/utils/result-wrappers/supabase";

export const ROW_CAP_ERROR_CODE = "row_cap";

// Probed against PostgREST: write representations (PATCH/POST/DELETE with
// return=representation) come back whole, so only reads and RPC results can
// be cut. HEAD carries a Content-Range for count queries but no rows. Auth and
// storage calls share the client but aren't PostgREST.
function isCappedRead(method: string, url: URL): boolean {
	if (!url.pathname.includes("/rest/v1/")) return false;
	if (method === "GET") return true;
	return method === "POST" && url.pathname.includes("/rest/v1/rpc/");
}

// "0-999/*" or "0-999/1001"; "*/*" (no rows) and anything else read as 0.
function countRangeRows(contentRange: string | null): number {
	const match = contentRange?.match(/^(\d+)-(\d+)\//);
	if (!match) return 0;
	return Number(match[2]) - Number(match[1]) + 1;
}

// `.range()` and `.limit()` add a top-level `limit` param, which declares a
// bounded page, so only one asking past max_rows is a bug.
function overCapLimit(url: URL): string | null {
	const limit = url.searchParams.get("limit");
	if (limit === null || Number(limit) <= POSTGREST_MAX_ROWS) return null;
	return `requests limit=${limit}, but PostgREST returns at most max_rows (${POSTGREST_MAX_ROWS}) rows; page it with readAllRows`;
}

// A read with no limit that fills max_rows exactly can't be told apart from a
// cut one, and one more row would cut it, so both count. Not covered: embedded
// one-to-many arrays (capped too, but absent from the top-level Content-Range)
// and LIMITs inside an RPC's SQL.
function unboundedReadAtCap(url: URL, response: Response): string | null {
	if (url.searchParams.has("limit")) return null;
	const rows = countRangeRows(response.headers.get("content-range"));
	if (rows < POSTGREST_MAX_ROWS) return null;
	return `has no limit and returned max_rows (${POSTGREST_MAX_ROWS}) rows, so it was probably truncated; page it with readAllRows (result-wrappers/supabase.ts) or push the work into SQL`;
}

function rowCapErrorResponse(message: string): Response {
	return new Response(
		JSON.stringify({
			code: ROW_CAP_ERROR_CODE,
			message,
			details: null,
			hint: null,
		}),
		{ status: 500, headers: { "Content-Type": "application/json" } },
	);
}

/**
 * Wraps the admin client's fetch so a PostgREST read cut at max_rows fails
 * with a PostgREST-shaped error instead of returning a silently short result
 * set.
 */
export function guardRowCap(
	baseFetch: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response>,
): typeof fetch {
	const guarded = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const method = (
			init?.method ?? (input instanceof Request ? input.method : "GET")
		).toUpperCase();
		if (!isCappedRead(method, url)) return baseFetch(input, init);

		// The path names the table or RPC; filter values stay out of Sentry.
		const where = `${method} ${url.pathname}`;
		const fail = (violation: string): Response => {
			const message = `[row-cap] ${where} ${violation}`;
			captureServerError(new Error(message), {
				operation: "postgrest_row_cap",
				area: "db",
				extra: { method, path: url.pathname },
			});
			// Many callers degrade a failed read to a fallback, which would hide
			// the error response, so the log line and the Sentry event above are
			// what make it visible.
			log.error("db:row-cap", { request: where, violation });
			return rowCapErrorResponse(message);
		};

		const limitViolation = overCapLimit(url);
		if (limitViolation !== null) return fail(limitViolation);

		const response = await baseFetch(input, init);
		if (!response.ok) return response;
		const capViolation = unboundedReadAtCap(url, response);
		if (capViolation === null) return response;
		// Best-effort: a throw here would replace the row_cap error with a fetch
		// error that postgrest-js retries.
		response.body?.cancel().catch(() => {});
		return fail(capViolation);
	};
	// Cast only because the wrapper lacks fetch's ambient `preconnect` static.
	return guarded as typeof fetch;
}
