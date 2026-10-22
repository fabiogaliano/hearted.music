/**
 * Client-side guard for server-function transport failures.
 *
 * TanStack Start's RPC client treats any `application/json` body that lacks
 * the `x-tss-serialized` header as a successful envelope and reads `.result`
 * off it. An infrastructure error page served as JSON (Cloudflare's 1102
 * "Worker exceeded resource limits", negotiated as JSON because the RPC
 * `accept` header lists it) therefore makes the server function resolve to
 * `undefined`. Plain queries then fail with "data is undefined"; infinite
 * queries are worse — the page is stored as `undefined` and the next render
 * crashes in `getNextPageParam` (Sentry HEARTED-MUSIC-1P/1N/1Q, 2026-10-17).
 *
 * Legitimate non-OK responses that must still reach the Start client untouched:
 * - Start's own serialized errors: 5xx with `x-tss-serialized: true`.
 * - A raw `Response` a server fn returned on purpose: `x-tss-raw: true`.
 * - `notFound()`: 404 JSON without either header, parsed by the client via
 *   `isNotFound`.
 * Redirects travel as 200 JSON (`isSerializedRedirect`) and are unaffected.
 *
 * Only the `createStart` default is guarded: a call-site `serverFn({ fetch })`
 * or a middleware-provided fetch takes precedence and bypasses this. No call
 * site does that today; keep it that way.
 */

export class ServerFnHttpError extends Error {
	readonly status: number;
	readonly bodyPreview: string;

	constructor(status: number, bodyPreview: string) {
		super(`Server function request failed with HTTP ${status}`);
		this.name = "ServerFnHttpError";
		this.status = status;
		this.bodyPreview = bodyPreview;
	}
}

const BODY_PREVIEW_LENGTH = 200;

// The callable half of `fetch` only. Bun's ambient `typeof fetch` also carries
// a `preconnect` static that a wrapper cannot satisfy; Start's `serverFns.fetch`
// option is typed the same way (its `CustomFetch`).
export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

function isStartHandledResponse(response: Response): boolean {
	if (response.ok) return true;
	if (response.headers.get("x-tss-serialized") === "true") return true;
	if (response.headers.get("x-tss-raw") === "true") return true;
	return response.status === 404;
}

/**
 * Wraps a fetch implementation so a transport-level error response rejects the
 * server-function call instead of resolving it to `undefined`.
 */
export function guardServerFnFetch(fetchImpl: FetchLike): FetchLike {
	return async (input, init) => {
		const response = await fetchImpl(input, init);
		if (isStartHandledResponse(response)) return response;

		// The body is consumed only on the throw path; successful responses
		// reach Start's decoder with their stream untouched.
		const body = await response.text().catch(() => "");
		throw new ServerFnHttpError(
			response.status,
			body.slice(0, BODY_PREVIEW_LENGTH),
		);
	};
}
