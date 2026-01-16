import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "./database.types";

/**
 * Server-side Supabase client with full type safety.
 *
 * Uses the anon key for public operations. For authenticated operations,
 * pass the user's access token to create an authenticated client.
 */
export function createSupabaseClient() {
	return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export type SupabaseClient = ReturnType<typeof createSupabaseClient>;
