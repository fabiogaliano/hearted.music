/**
 * Prod service-role Supabase client for operations (RPC + account lookups).
 *
 * REST + service-role is the right tool for whole-row reads and RPC calls — it
 * physically can't run a stray DROP, and writes still go through the panel's
 * confirm step. The key bypasses RLS, which is fine because this only ever runs
 * locally on your machine.
 */

import { createClient } from "@supabase/supabase-js";
import { getRestCreds } from "./prod-creds";

let client: ReturnType<typeof createClient> | null = null;

export function prodSupabase(): ReturnType<typeof createClient> {
	if (!client) {
		const { url, key } = getRestCreds();
		client = createClient(url, key, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
	}
	return client;
}
