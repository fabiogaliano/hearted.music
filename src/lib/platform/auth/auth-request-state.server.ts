import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Result } from "better-result";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/env";
import { getSql } from "@/lib/data/sql";
import {
	oauthAccount,
	rateLimit,
	session,
	user,
	verification,
} from "@/lib/platform/auth/auth-schema";
import { sendPasswordResetEmail } from "@/lib/platform/email/send-password-reset-email";
import { sendVerificationEmail } from "@/lib/platform/email/send-verification-email";

function createBetterAuth() {
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		// No session cookie cache: every session read hits the DB so logout and
		// revocation take effect immediately.
		database: drizzleAdapter(drizzle(getSql()), {
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
						prompt: "select_account",
					},
				}),
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
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
		advanced: {
			ipAddress: {
				ipAddressHeaders: ["cf-connecting-ip"],
			},
		},
		rateLimit: {
			enabled: Boolean(import.meta.env.PROD),
			storage: "database",
			window: 60,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 60, max: 10 },
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

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

let auth: BetterAuthInstance | undefined;

// Built once per process: constructing it per request was a large share of
// every authenticated request's CPU on Workers. Lazy for the same reason as
// getSql().
export function getAuth(): BetterAuthInstance {
	auth ??= createBetterAuth();
	return auth;
}
