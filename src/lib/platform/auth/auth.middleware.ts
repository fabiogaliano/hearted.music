/**
 * TanStack Start auth middleware for server functions.
 *
 * Resolves the session + account from the request and injects them
 * into middleware context. Server function handlers access auth via
 * `context.session` and `context.account` instead of calling
 * requireAuthSession() directly.
 *
 * Two variants:
 *   - `authMiddleware`     — requires auth, throws redirect if missing
 *   - `optionalAuthMiddleware` — resolves auth if present, null if not
 */

import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import {
	getAuthSession,
	type AppSession,
} from "@/lib/platform/auth/auth.server";
import type { Account } from "@/lib/domains/library/accounts/queries";

export interface AuthContext {
	session: AppSession;
	account: Account | null;
}

export interface OptionalAuthContext {
	session: AppSession | null;
	account: Account | null;
}

/**
 * Requires authentication. Redirects to "/" if not authenticated.
 * Use on all protected server functions.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const authContext = await getAuthSession();

		if (!authContext) {
			throw redirect({ to: "/" });
		}

		return next({
			context: {
				session: authContext.session,
				account: authContext.account,
			},
		});
	},
);

/**
 * Resolves auth if present, passes null if not.
 * Use on server functions where auth is optional (e.g. landing page data).
 */
export const optionalAuthMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const authContext = await getAuthSession();

	return next({
		context: {
			session: authContext?.session ?? null,
			account: authContext?.account ?? null,
		},
	});
});
