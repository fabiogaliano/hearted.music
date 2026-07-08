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
	getAccountByBetterAuthUserId,
	touchAccountLastSeen,
} from "@/lib/domains/library/accounts/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { getAuth } from "@/lib/platform/auth/auth";
import { getAuthRequestState } from "@/lib/platform/auth/auth-request-state";
import type { AuthContext } from "@/lib/platform/auth/auth-types";
import { errorMessage } from "@/lib/shared/errors/error-message";

/**
 * Gets the current auth session, or null if not authenticated.
 * Use in contexts where auth is optional (e.g., landing page).
 */
export async function getAuthSession(): Promise<AuthContext | null> {
	const authRequest = getAuthRequestState();
	const cachedSession = authRequest.getCachedSession();

	if (cachedSession) {
		return cachedSession;
	}

	return authRequest.cacheSession(loadAuthSession());
}

async function loadAuthSession(): Promise<AuthContext | null> {
	try {
		const request = getRequest();
		const betterAuthSession = await getAuth().api.getSession({
			headers: request.headers,
		});

		if (!betterAuthSession) return null;

		const accountResult = await getAccountByBetterAuthUserId(
			betterAuthSession.user.id,
		);
		const accountWithActivity = Result.isOk(accountResult)
			? accountResult.value
			: null;

		if (!accountWithActivity) return null;

		const { account, lastSeenAt } = accountWithActivity;

		recordLastSeen(account.id, lastSeenAt);

		return {
			session: { accountId: account.id, id: betterAuthSession.session.id },
			account,
			identity: {
				email: betterAuthSession.user.email,
				emailVerified: betterAuthSession.user.emailVerified,
			},
		};
	} catch (error) {
		const message = errorMessage(error);
		console.warn("Failed to get auth session:", message);
		// An auth/DB outage here makes an authed user look anonymous; with the
		// server's enableLogs:false the console.warn never reaches Sentry, so a
		// widespread outage would be invisible. Capture, but keep returning null so
		// the optional-auth contract is unchanged.
		captureServerError(error, {
			area: "auth",
			operation: "load_auth_session",
		});
		return null;
	}
}

const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Fire-and-forget "last active" heartbeat.
 *
 * Gates in-process on the last_seen_at we already read with the account, so the
 * common fresh path makes no extra round-trip; touch_account_last_seen applies
 * the authoritative 10-minute throttle in SQL, which also makes concurrent
 * requests correct regardless of this check or Worker clock skew. Runs after
 * the response via waitUntil so it never adds latency, and its failure is
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

	void runAfterResponse(heartbeat);
}

async function runAfterResponse(promise: Promise<unknown>): Promise<void> {
	try {
		const { waitUntil } = await import("cloudflare:workers");
		waitUntil(promise);
	} catch {
		await promise;
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
