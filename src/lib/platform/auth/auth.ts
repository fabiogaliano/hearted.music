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
	rateLimit,
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
				rateLimit,
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
		// Without this, rate-limit keys default to x-forwarded-for. On Cloudflare
		// that's the spoofable hop list, not the trusted edge IP — an attacker
		// could forge it to dodge the per-IP login cap. cf-connecting-ip is set by
		// the edge and can't be overridden by the client.
		advanced: {
			ipAddress: {
				ipAddressHeaders: ["cf-connecting-ip"],
			},
		},
		rateLimit: {
			// Auto-on in production only; local dev stays unthrottled so the
			// rate_limit migration isn't a prerequisite for running the app.
			enabled: import.meta.env.PROD,
			// Database storage, not the in-memory default: Worker isolates share no
			// memory, so memory storage silently never rate limits on Cloudflare.
			storage: "database",
			window: 60,
			max: 100,
			customRules: {
				// Tight cap on the credential-stuffing surface, per IP.
				"/sign-in/email": { window: 60, max: 10 },
				// Slow password-reset email spam / account enumeration.
				"/forget-password": { window: 60, max: 5 },
			},
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
