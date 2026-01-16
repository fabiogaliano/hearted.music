import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "./database.types";

/**
 * Server-side Supabase client with anon key.
 * Use for public operations that respect RLS.
 */
export function createPublicSupabaseClient() {
	return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

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

export type SupabaseClient = ReturnType<typeof createPublicSupabaseClient>;
export type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;
