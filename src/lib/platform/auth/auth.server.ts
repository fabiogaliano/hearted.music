/**
 * Server-side session helpers.
 *
 * Replaces the old getSession/requireSession from lib/auth/session.ts
 * and requireAuth from lib/auth/guards.ts.
 *
 * Returns the same { session, account } shape for backward compatibility.
 */

import { redirect } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import {
	type Account,
	getAccountByBetterAuthUserId,
} from "@/lib/domains/library/accounts/queries";
import { getAuth } from "@/lib/platform/auth/auth";

export interface AppSession {
	accountId: string;
}

export interface AuthIdentity {
	email: string;
	emailVerified: boolean;
}

interface AuthContext {
	session: AppSession;
	account: Account | null;
	identity: AuthIdentity;
}

/**
 * Gets the current auth session, or null if not authenticated.
 * Use in contexts where auth is optional (e.g., landing page).
 */
export async function getAuthSession(): Promise<AuthContext | null> {
	try {
		const request = getRequest();
		const betterAuthSession = await getAuth().api.getSession({
			headers: request.headers,
		});

		if (!betterAuthSession) return null;

		const accountResult = await getAccountByBetterAuthUserId(
			betterAuthSession.user.id,
		);
		const account = Result.isOk(accountResult) ? accountResult.value : null;

		if (!account) return null;

		return {
			session: { accountId: account.id },
			account,
			identity: {
				email: betterAuthSession.user.email,
				emailVerified: betterAuthSession.user.emailVerified,
			},
		};
	} catch (error) {
		console.warn("Failed to get auth session:", (error as Error).message);
		return null;
	}
}

/**
 * Requires authentication, throws redirect to "/" if not authenticated.
 * Use in route guards (beforeLoad) and server functions that need auth.
 */
export async function requireAuthSession(): Promise<AuthContext> {
	const authContext = await getAuthSession();

	if (!authContext) {
		throw redirect({ to: "/" });
	}

	return authContext;
}
