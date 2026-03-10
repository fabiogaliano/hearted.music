import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Safe access to process.env - returns undefined on client where process doesn't exist.
 * This is needed because runtimeEnv is evaluated at module load time.
 */
const serverEnv =
	typeof process !== "undefined" ? process.env : ({} as NodeJS.ProcessEnv);

export const env = createEnv({
	server: {
		SERVER_URL: z.url().optional(),
		SUPABASE_URL: z.url(),
		SUPABASE_ANON_KEY: z.string().min(1),
		SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
		// Better Auth
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		DATABASE_URL: z.string().min(1),
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
		// Spotify Client Credentials (optional - used for album art fetching, not user auth)
		SPOTIFY_CLIENT_ID: z.string().min(1).optional(),
		SPOTIFY_CLIENT_SECRET: z.string().min(1).optional(),
		// Matching pipeline services (optional - graceful degradation)
		LASTFM_API_KEY: z.string().min(1).optional(),
		DEEPINFRA_API_KEY: z.string().min(1).optional(),
		HF_TOKEN: z.string().min(1).optional(),
		GENIUS_CLIENT_TOKEN: z.string().min(1).optional(),
		// ML provider selection (optional - defaults to deepinfra if key exists, else huggingface)
		ML_PROVIDER: z.enum(["deepinfra", "huggingface", "local"]).optional(),
		// Email (optional - waitlist confirmation emails skipped if not set)
		RESEND_API_KEY: z.string().min(1).optional(),
	},

	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_CHROME_EXTENSION_ID: z.string().min(1).optional(),
	},

	/**
	 * Tell t3-env when we're on the server so it knows when to validate server vars.
	 * On client, server vars return a proxy that throws if accessed.
	 */
	isServer: typeof window === "undefined",

	/**
	 * Server vars from process.env (TanStack Start loads .env on server).
	 * Client vars from import.meta.env (Vite bundles VITE_* vars).
	 */
	runtimeEnv: {
		SERVER_URL: serverEnv.SERVER_URL,
		SUPABASE_URL: serverEnv.SUPABASE_URL,
		SUPABASE_ANON_KEY: serverEnv.SUPABASE_ANON_KEY,
		SUPABASE_SERVICE_ROLE_KEY: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
		BETTER_AUTH_SECRET: serverEnv.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: serverEnv.BETTER_AUTH_URL,
		DATABASE_URL: serverEnv.DATABASE_URL,
		GOOGLE_CLIENT_ID: serverEnv.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: serverEnv.GOOGLE_CLIENT_SECRET,
		SPOTIFY_CLIENT_ID: serverEnv.SPOTIFY_CLIENT_ID,
		SPOTIFY_CLIENT_SECRET: serverEnv.SPOTIFY_CLIENT_SECRET,
		LASTFM_API_KEY: serverEnv.LASTFM_API_KEY,
		DEEPINFRA_API_KEY: serverEnv.DEEPINFRA_API_KEY,
		HF_TOKEN: serverEnv.HF_TOKEN,
		GENIUS_CLIENT_TOKEN: serverEnv.GENIUS_CLIENT_TOKEN,
		ML_PROVIDER: serverEnv.ML_PROVIDER,
		RESEND_API_KEY: serverEnv.RESEND_API_KEY,
		VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
		VITE_CHROME_EXTENSION_ID: import.meta.env.VITE_CHROME_EXTENSION_ID,
	},

	emptyStringAsUndefined: true,
});
