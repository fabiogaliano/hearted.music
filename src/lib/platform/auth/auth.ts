/**
 * Better Auth server configuration.
 *
 * Uses Drizzle + postgres.js for Postgres access (works with local Supabase
 * and Supabase transaction pooler on Cloudflare Workers).
 * Drizzle is ONLY used for Better Auth — app data stays on @supabase/supabase-js.
 *
 * Per-request: each call creates a fresh postgres connection to avoid
 * Cloudflare Workers' cross-request I/O isolation errors.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Result } from "better-result";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import {
	oauthAccount,
	session,
	user,
	verification,
} from "@/lib/platform/auth/auth-schema";
import { sendPasswordResetEmail } from "@/lib/platform/email/send-password-reset-email";
import { sendVerificationEmail } from "@/lib/platform/email/send-verification-email";

export function getAuth() {
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
				user,
				session,
				oauthAccount,
				verification,
				account: oauthAccount,
				oauth_account: oauthAccount,
			},
		}),
		socialProviders: {
			...(env.GOOGLE_CLIENT_ID &&
				env.GOOGLE_CLIENT_SECRET && {
					google: {
						clientId: env.GOOGLE_CLIENT_ID,
						clientSecret: env.GOOGLE_CLIENT_SECRET,
					},
				}),
		},
		emailAndPassword: {
			enabled: true,
			// Soft verification: users can sign in immediately. The verification
			// email still goes out via emailVerification.sendOnSignUp below; the
			// app shell shows a non-blocking banner until `user.emailVerified`
			// flips to true. Flip this to `true` if we ever want a hard gate.
			requireEmailVerification: false,
			autoSignIn: true,
			minPasswordLength: 8,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				await sendPasswordResetEmail({ to: user.email, resetUrl: url });
			},
		},
		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await sendVerificationEmail({ to: user.email, verifyUrl: url });
			},
		},
		account: {
			modelName: "oauth_account",
			encryptOAuthTokens: true,
		},
		plugins: [tanstackStartCookies()],
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						const { createAccountForBetterAuthUser } = await import(
							"@/lib/domains/library/accounts/queries"
						);
						const result = await createAccountForBetterAuthUser({
							better_auth_user_id: user.id,
							email: user.email,
							display_name: user.name,
						});
						if (Result.isError(result)) {
							throw new Error(
								`Failed to create app account for user ${user.id}: ${result.error}`,
							);
						}
					},
				},
			},
		},
	});
}
