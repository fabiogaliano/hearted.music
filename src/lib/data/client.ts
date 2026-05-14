import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "./database.types";

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
		},
	);
}

export type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;
