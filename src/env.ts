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
		SPOTIFY_CLIENT_ID: z.string().min(1),
		SPOTIFY_CLIENT_SECRET: z.string().min(1),
		SPOTIFY_REDIRECT_URI: z.url(),
		SESSION_SECRET: z.string().min(32),
	},

	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
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
		SPOTIFY_CLIENT_ID: serverEnv.SPOTIFY_CLIENT_ID,
		SPOTIFY_CLIENT_SECRET: serverEnv.SPOTIFY_CLIENT_SECRET,
		SPOTIFY_REDIRECT_URI: serverEnv.SPOTIFY_REDIRECT_URI,
		SESSION_SECRET: serverEnv.SESSION_SECRET,
		VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
	},

	emptyStringAsUndefined: true,
});
