import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "./database.types";

/**
 * nginx/Kong sit in front of PostgREST and cap the request line at roughly
 * this length. A `.in()` filter built from a DB-derived id set can grow past
 * it in prod (see CLAUDE.md: DB-derived id sets must go through an RPC/join,
 * not `.in()`), which fails as a 414 there instead of locally.
 */
const MAX_ADMIN_REQUEST_URL_LENGTH = 8_000;

// Dev/test-only so the failure mode surfaces locally instead of as a prod 414.
const shouldGuardAdminRequestUrlLength =
	import.meta.env.DEV || import.meta.env.MODE === "test";

function guardAdminRequestUrlLength(
	input: RequestInfo | URL,
	init?: RequestInit,
) {
	const url = input instanceof Request ? input.url : String(input);
	if (url.length > MAX_ADMIN_REQUEST_URL_LENGTH) {
		throw new Error(
			`[createAdminSupabaseClient] Request URL is ${url.length} chars, over the ` +
				`${MAX_ADMIN_REQUEST_URL_LENGTH}-char guard. This is almost always a DB-derived ` +
				"id set re-entering a query as an .in() URL filter, which 414s in prod behind " +
				"nginx/Kong. Push the predicate into an RPC/join instead — chunkedRead " +
				"(src/lib/shared/utils/chunked-read.ts) is only for externally-sourced id lists. " +
				"See the CLAUDE.md rule on DB-derived id sets.",
		);
	}
	return fetch(input, init);
}

// A stable-shaped `global.fetch` option (rather than conditionally spreading
// the option in) keeps createClient's options-object type — and therefore
// AdminSupabaseClient's inferred generics — identical in prod, where this
// must be a pure passthrough. Cast needed only because our guard lacks the
// ambient `fetch.preconnect` static that `typeof fetch` otherwise requires.
const adminFetch = (
	shouldGuardAdminRequestUrlLength ? guardAdminRequestUrlLength : fetch
) as typeof fetch;

/**
 * Server-side Supabase client with service role key.
 * Bypasses RLS - use for auth operations where we can't use auth.uid().
 *
 * IMPORTANT: Never expose this client to the browser.
 */
export function createAdminSupabaseClient() {
	return createClient<Database>(
		env.SUPABASE_URL,
		env.SUPABASE_SERVICE_ROLE_KEY,
		{
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
			global: {
				fetch: adminFetch,
			},
		},
	);
}

export type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;
