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
import type { AuthContext } from "@/lib/platform/auth/auth-types";
import { sendPasswordResetEmail } from "@/lib/platform/email/send-password-reset-email";
import { sendVerificationEmail } from "@/lib/platform/email/send-verification-email";

export interface AuthRequestState {
	getAuth(): BetterAuthInstance;
	getCachedSession(): Promise<AuthContext | null> | undefined;
	cacheSession(
		sessionPromise: Promise<AuthContext | null>,
	): Promise<AuthContext | null>;
	close(): Promise<void>;
}

type AuthSqlClient = ReturnType<typeof postgres>;
export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

const CONNECTION_IDLE_TIMEOUT_SECONDS = 20;
const CONNECTION_CLOSE_TIMEOUT_SECONDS = 5;

export function createAuthRequestState(): AuthRequestState {
	let sql: AuthSqlClient | undefined;
	let auth: BetterAuthInstance | undefined;
	let authSessionPromise: Promise<AuthContext | null> | undefined;
	let closePromise: Promise<void> | undefined;

	function getSql(): AuthSqlClient {
		if (sql) return sql;

		sql = postgres(env.DATABASE_URL, {
			prepare: false,
			max: 1,
			idle_timeout: CONNECTION_IDLE_TIMEOUT_SECONDS,
			fetch_types: false,
		});

		return sql;
	}

	return {
		getAuth() {
			if (auth) return auth;
			auth = createBetterAuth(getSql());
			return auth;
		},
		getCachedSession() {
			return authSessionPromise;
		},
		cacheSession(sessionPromise) {
			authSessionPromise ??= sessionPromise;
			return authSessionPromise;
		},
		close() {
			if (closePromise) return closePromise;
			if (!sql) {
				closePromise = Promise.resolve();
				return closePromise;
			}

			closePromise = sql
				.end({ timeout: CONNECTION_CLOSE_TIMEOUT_SECONDS })
				.then(() => undefined);
			return closePromise;
		},
	};
}

function createBetterAuth(sql: AuthSqlClient) {
	const db = drizzle(sql);

	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		// On Workers a TCP socket can't outlive the request that opened it, so each
		// session read would otherwise pay a fresh TCP+TLS handshake to Postgres.
		// The cookie cache serves the session from a signed cookie, so the DB (and
		// thus the connection) is only touched when the cache expires. Tradeoff:
		// server-side revocations lag by up to maxAge on already-issued cookies.
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 5 * 60,
			},
		},
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
			enabled: import.meta.env.PROD,
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

export async function closeAuthRequestAfterResponse(
	authRequest: AuthRequestState,
): Promise<void> {
	const closePromise = authRequest.close();

	try {
		const { waitUntil } = await import("cloudflare:workers");
		waitUntil(closePromise);
	} catch {
		await closePromise;
	}
}
