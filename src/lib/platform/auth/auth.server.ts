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
import { Result, TaggedError } from "better-result";
import {
	getAccountByBetterAuthUserId,
	touchAccountLastSeen,
} from "@/lib/domains/library/accounts/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { getAuthRequestState } from "@/lib/platform/auth/auth-request-state";
import { getAuth } from "@/lib/platform/auth/auth-request-state.server";
import type {
	AuthContext,
	AuthSessionState,
} from "@/lib/platform/auth/auth-types";
import { runAfterResponse } from "@/lib/platform/process/after-response";
import { errorMessage } from "@/lib/shared/errors/error-message";

export class AuthUnavailableError extends TaggedError("AuthUnavailableError")<{
	message: string;
}> {}

export function getAuthSessionState(): Promise<AuthSessionState> {
	const authRequest = getAuthRequestState();
	const cachedSession = authRequest.getCachedSession();

	if (cachedSession) {
		return cachedSession;
	}

	return authRequest.cacheSession(loadAuthSession());
}

/**
 * Gets the current auth session, or null if not authenticated.
 * Use in contexts where auth is optional (e.g., landing page).
 * Throws AuthUnavailableError when the session can't be resolved: callers fail
 * instead of treating a signed-in user as anonymous.
 */
export async function getAuthSession(): Promise<AuthContext | null> {
	const state = await getAuthSessionState();
	switch (state.status) {
		case "authenticated":
			return state.auth;
		case "unauthenticated":
			return null;
		case "unavailable":
			throw new AuthUnavailableError({
				message: "Auth session is temporarily unavailable",
			});
	}
}

async function loadAuthSession(): Promise<AuthSessionState> {
	try {
		const request = getRequest();
		const betterAuthSession = await getAuth().api.getSession({
			headers: request.headers,
		});

		if (!betterAuthSession) return { status: "unauthenticated" };

		const accountResult = await getAccountByBetterAuthUserId(
			betterAuthSession.user.id,
		);
		if (Result.isError(accountResult)) {
			captureServerError(accountResult.error, {
				area: "auth",
				operation: "load_auth_session_account",
			});
			return { status: "unavailable" };
		}

		if (!accountResult.value) return { status: "unauthenticated" };

		const { account, lastSeenAt } = accountResult.value;

		recordLastSeen(account.id, lastSeenAt);

		return {
			status: "authenticated",
			auth: {
				session: {
					accountId: account.id,
					id: betterAuthSession.session.id,
					createdAt: betterAuthSession.session.createdAt,
				},
				account,
				identity: {
					email: betterAuthSession.user.email,
					emailVerified: betterAuthSession.user.emailVerified,
				},
			},
		};
	} catch (error) {
		console.warn("Failed to get auth session:", errorMessage(error));
		// console.warn never reaches Sentry with enableLogs:false; capture explicitly
		captureServerError(error, {
			area: "auth",
			operation: "load_auth_session",
		});
		return { status: "unavailable" };
	}
}

const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Fire-and-forget "last active" heartbeat.
 *
 * Gates in-process on the last_seen_at we already read with the account, so the
 * common fresh path makes no extra round-trip; touch_account_last_seen applies
 * the authoritative 10-minute throttle in SQL, which also makes concurrent
 * requests correct regardless of this check or clock skew. Runs after the
 * response so it never adds latency, and its failure is
 * intentionally swallowed — a missed heartbeat must not break auth.
 */
function recordLastSeen(accountId: string, lastSeenAt: string | null): void {
	const isFresh =
		lastSeenAt !== null &&
		Date.now() - new Date(lastSeenAt).getTime() < LAST_SEEN_THROTTLE_MS;

	if (isFresh) return;

	const heartbeat = touchAccountLastSeen(accountId).catch((error) => {
		console.warn("Failed to record last_seen_at:", errorMessage(error));
		// A missed heartbeat is non-fatal, but a persistent failure would silently
		// rot last_seen_at across all accounts; surface it (console is not enough
		// with enableLogs:false).
		captureServerError(error, {
			area: "auth",
			operation: "touch_account_last_seen",
			accountId,
		});
	});

	runAfterResponse(heartbeat);
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
