/**
 * Better Auth server configuration.
 *
 * Uses Drizzle + postgres.js for Postgres access (works with local Supabase
 * and Supabase transaction pooler on Cloudflare Workers).
 * Drizzle is ONLY used for Better Auth — app data stays on @supabase/supabase-js.
 *
 * Lazy singleton: reused within a CF Workers isolate, recreated if evicted.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/env";
import * as authSchema from "@/lib/auth-schema";

function createAuth() {
	const sql = postgres(env.DATABASE_URL, {
		prepare: false,
		max: 1,
		idle_timeout: 20,
		fetch_types: false,
	});
	const db = drizzle(sql);

	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: {
				...authSchema,
				account: authSchema.oauthAccount,
				oauth_account: authSchema.oauthAccount,
			},
		}),
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
			},
		},
		account: {
			modelName: "oauth_account",
		},
		plugins: [tanstackStartCookies()],
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						const { createAccountForBetterAuthUser } = await import(
							"@/lib/data/accounts"
						);
						await createAccountForBetterAuthUser({
							better_auth_user_id: user.id,
							email: user.email,
							display_name: user.name,
						});
					},
				},
			},
		},
	});
}

let authInstance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
	if (!authInstance) {
		authInstance = createAuth();
	}
	return authInstance;
}

export type Auth = ReturnType<typeof getAuth>;
